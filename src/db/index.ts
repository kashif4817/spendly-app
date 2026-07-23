import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';

import { PRESET_CATEGORIES } from '@/constants/categories';
import { todayKey } from '@/lib/date';

export type EntryType = 'in' | 'out';

export type Transaction = {
  id: string;
  type: EntryType;
  amount: number;
  category: string;
  note: string;
  day: string; // 'YYYY-MM-DD' local
  created_at: string; // ISO timestamp
  receipt_path: string | null; // Supabase Storage path, or null
};

export type Category = {
  id: string;
  name: string;
  emoji: string;
  type: EntryType;
  is_preset: number;
  sort: number;
};

/** 'given' = I lent money (they owe me), 'taken' = I borrowed (I owe them). */
export type LoanDirection = 'given' | 'taken';

export type Loan = {
  id: string;
  direction: LoanDirection;
  person: string;
  amount: number;
  note: string;
  day: string; // 'YYYY-MM-DD' local
  created_at: string; // ISO timestamp
  repaid: number; // sum of recorded repayments (derived, not stored)
};

export type LoanPayment = {
  id: string;
  loan_id: string;
  amount: number;
  day: string;
  created_at: string;
};

/** Outstanding balances across all open loans. */
export type LoanTotals = {
  owedToMe: number; // remaining on loans I gave
  iOwe: number; // remaining on loans I took
};

// --- People ledger (khata) --------------------------------------------------
// A running per-person account: each entry is a single "I gave" or "I took",
// and a person's balance is Σ(gave) − Σ(took). Positive = they owe you
// (receivable); negative = you owe them (payable).

export type LedgerDirection = 'gave' | 'took';

export type LedgerEntry = {
  id: string;
  person: string;
  direction: LedgerDirection;
  amount: number;
  note: string;
  day: string;
  created_at: string;
};

/** One person's rolled-up standing. */
export type PersonBalance = {
  person: string;
  balance: number; // >0 they owe you, <0 you owe them
  entries: number;
  lastDay: string;
};

/** Totals across everyone. */
export type LedgerTotals = {
  receivable: number; // sum of positive balances
  payable: number; // sum of |negative balances|
};

/** Sentinel category for the overall (all-spending) monthly budget. */
export const OVERALL_BUDGET = '';

/** A monthly spending limit; category '' means all spending. */
export type Budget = {
  id: string;
  category: string;
  amount: number;
};

/** One budget's limit vs. what was actually spent in a period. */
export type BudgetProgress = {
  category: string;
  budget: number;
  spent: number;
};

/** In/out totals + net for a period. */
export type Totals = {
  income: number;
  expense: number;
  net: number;
};

/** One category's contribution within a period. */
export type CategorySlice = {
  category: string;
  total: number;
  count: number;
};

/** One day's in/out, used for the weekly chart. */
export type DayTotal = {
  day: string;
  income: number;
  expense: number;
};

// --- Sync model -------------------------------------------------------------
// Every data table uses a TEXT (UUID) primary key so a row keeps the same
// identity on every device, plus `user_id` (which account owns it) and
// `updated_at` (for last-write-wins). Local deletes are immediate; the deletion
// is remembered in `sync_outbox` so it can be mirrored to the server. Reads are
// unaffected — they never see tombstones because deletes are applied locally.

/** Data tables that sync to Supabase, in a dependency-friendly order. */
export const SYNC_TABLES = [
  'categories',
  'transactions',
  'loans',
  'loan_payments',
  'budgets',
  'ledger_entries',
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

/** Data columns per table (excludes the common id / user_id / updated_at). */
export const TABLE_COLUMNS: Record<SyncTable, string[]> = {
  categories: ['name', 'emoji', 'type', 'is_preset', 'sort'],
  transactions: ['type', 'amount', 'category', 'note', 'day', 'created_at', 'receipt_path'],
  loans: ['direction', 'person', 'amount', 'note', 'day', 'created_at'],
  loan_payments: ['loan_id', 'amount', 'day', 'created_at'],
  budgets: ['category', 'amount'],
  ledger_entries: ['person', 'direction', 'amount', 'note', 'day', 'created_at'],
};

/** All columns for a table, in a stable order (id first, updated_at last). */
export function columnsFor(table: SyncTable): string[] {
  return ['id', 'user_id', ...TABLE_COLUMNS[table], 'updated_at'];
}

const newId = () => Crypto.randomUUID();
const nowIso = () => new Date().toISOString();

// The account whose rows new writes belong to. Set on sign-in; null when signed
// out (the app is gated behind auth, so writes only happen while it's set).
let currentUserId: string | null = null;

export function setCurrentUserId(id: string | null): void {
  currentUserId = id;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

// Single shared connection for the whole app. `enableChangeListener` powers the
// live-refresh hook (see db/hooks.ts).
const db = SQLite.openDatabaseSync('expenses.db', { enableChangeListener: true });

const DATABASE_VERSION = 6;

let dbInitError: string | null = null;

/** A fatal migration/open error, surfaced by the auth screen instead of a blank app. */
export function getDbInitError(): string | null {
  return dbInitError;
}

// --- Lightweight change bus -------------------------------------------------
// Fires when data changes in a way the native SQLite change listener may miss
// (a sync wipe, or applying a batch of pulled rows). Screens subscribe via the
// useQuery hook so they re-render after a background sync.

type Listener = () => void;
const listeners = new Set<Listener>();

export function onDbChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifyDbChanged(): void {
  listeners.forEach((fn) => fn());
}

// --- Schema -----------------------------------------------------------------

/** The always-present metadata tables (outbox + sync cursor). */
function createMetaTables(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS sync_outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      user_id TEXT,
      last_pulled_at TEXT
    );
    INSERT OR IGNORE INTO sync_state (id, user_id, last_pulled_at) VALUES (1, NULL, NULL);
  `);
}

/** The five synced data tables, with UUID ids + user_id + updated_at. */
function createDataTables(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL CHECK (type IN ('in', 'out')),
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      day TEXT NOT NULL,
      created_at TEXT NOT NULL,
      receipt_path TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_day ON transactions(day);

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('in', 'out')),
      is_preset INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (name, type)
    );

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL CHECK (direction IN ('given', 'taken')),
      person TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      day TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loan_payments (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      loan_id TEXT NOT NULL,
      amount REAL NOT NULL,
      day TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_loan_payments_loan ON loan_payments(loan_id);

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (category)
    );
  `);
  createLedgerTable();
}

/** The people-ledger table (also created on its own for the v5 → v6 upgrade). */
function createLedgerTable(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      person TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('gave', 'took')),
      amount REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      day TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_person ON ledger_entries(person);
  `);
}

/**
 * Fold the old one-loan-at-a-time data into the people ledger. Each loan
 * becomes a single give/take entry and each repayment becomes the opposite —
 * so per-person balances carry over. IDs are derived from the source row's id
 * (`L-…` / `P-…`) so every device migrates to the SAME entry, never a duplicate.
 */
function migrateLoansToLedger(): void {
  db.withTransactionSync(() => {
    const loans = db.getAllSync<any>('SELECT * FROM loans');
    for (const l of loans) {
      const id = `L-${l.id}`;
      const direction = l.direction === 'given' ? 'gave' : 'took';
      const res = db.runSync(
        `INSERT OR IGNORE INTO ledger_entries (id, user_id, person, direction, amount, note, day, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, l.user_id ?? '', l.person, direction, l.amount, l.note ?? '', l.day, l.created_at, l.updated_at ?? nowIso()
      );
      if (res.changes > 0) enqueue('ledger_entries', id, 'upsert', l.updated_at ?? nowIso());
    }

    const payments = db.getAllSync<any>(
      `SELECT p.*, l.person AS loan_person, l.direction AS loan_dir
       FROM loan_payments p JOIN loans l ON l.id = p.loan_id`
    );
    for (const p of payments) {
      const id = `P-${p.id}`;
      // A repayment moves money the other way, so it flips the loan's direction.
      const direction = p.loan_dir === 'given' ? 'took' : 'gave';
      const res = db.runSync(
        `INSERT OR IGNORE INTO ledger_entries (id, user_id, person, direction, amount, note, day, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, p.user_id ?? '', p.loan_person, direction, p.amount, 'Repayment', p.day, p.created_at, p.updated_at ?? nowIso()
      );
      if (res.changes > 0) enqueue('ledger_entries', id, 'upsert', p.updated_at ?? nowIso());
    }
  });
}

/**
 * One-time upgrade from the pre-sync integer-id schema (versions 1–3) to the
 * UUID + user_id schema (version 4). Existing rows are preserved: each gets a
 * fresh UUID, loan repayments are re-pointed to their loan's new id, and every
 * row is left unassigned (user_id = '') so it can be adopted into the first
 * account that signs in on this device.
 */
function convertLegacyToV4(): void {
  db.withTransactionSync(() => {
    db.execSync(`
      ALTER TABLE transactions RENAME TO _old_transactions;
      ALTER TABLE categories RENAME TO _old_categories;
      ALTER TABLE loans RENAME TO _old_loans;
      ALTER TABLE loan_payments RENAME TO _old_loan_payments;
      ALTER TABLE budgets RENAME TO _old_budgets;
    `);

    createDataTables();

    const stamp = nowIso();

    // Loans first, so payments can be re-pointed to the new loan ids.
    const loanIdMap = new Map<number, string>();
    for (const l of db.getAllSync<any>('SELECT * FROM _old_loans')) {
      const id = newId();
      loanIdMap.set(l.id, id);
      db.runSync(
        `INSERT INTO loans (id, user_id, direction, person, amount, note, day, created_at, updated_at)
         VALUES (?, '', ?, ?, ?, ?, ?, ?, ?)`,
        id, l.direction, l.person, l.amount, l.note ?? '', l.day, l.created_at, stamp
      );
    }

    for (const p of db.getAllSync<any>('SELECT * FROM _old_loan_payments')) {
      const loanId = loanIdMap.get(p.loan_id);
      if (!loanId) continue; // orphaned payment; drop it
      db.runSync(
        `INSERT INTO loan_payments (id, user_id, loan_id, amount, day, created_at, updated_at)
         VALUES (?, '', ?, ?, ?, ?, ?)`,
        newId(), loanId, p.amount, p.day, p.created_at, stamp
      );
    }

    for (const t of db.getAllSync<any>('SELECT * FROM _old_transactions')) {
      db.runSync(
        `INSERT INTO transactions (id, user_id, type, amount, category, note, day, created_at, updated_at)
         VALUES (?, '', ?, ?, ?, ?, ?, ?, ?)`,
        newId(), t.type, t.amount, t.category, t.note ?? '', t.day, t.created_at, stamp
      );
    }

    for (const c of db.getAllSync<any>('SELECT * FROM _old_categories')) {
      db.runSync(
        `INSERT INTO categories (id, user_id, name, emoji, type, is_preset, sort, updated_at)
         VALUES (?, '', ?, ?, ?, ?, ?, ?)`,
        newId(), c.name, c.emoji, c.type, c.is_preset, c.sort, stamp
      );
    }

    for (const b of db.getAllSync<any>('SELECT * FROM _old_budgets')) {
      db.runSync(
        `INSERT INTO budgets (id, user_id, category, amount, updated_at)
         VALUES (?, '', ?, ?, ?)`,
        newId(), b.category, b.amount, stamp
      );
    }

    db.execSync(`
      DROP TABLE _old_transactions;
      DROP TABLE _old_categories;
      DROP TABLE _old_loans;
      DROP TABLE _old_loan_payments;
      DROP TABLE _old_budgets;
    `);
  });
}

function hasColumn(table: string, column: string): boolean {
  const cols = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

/** Bring an old integer-schema database up to the full v3 shape before converting. */
function ensureLegacyV3Shape(version: number): void {
  if (version < 2) {
    db.execSync(`
      CREATE TABLE IF NOT EXISTS loans (
        id INTEGER PRIMARY KEY NOT NULL, direction TEXT NOT NULL, person TEXT NOT NULL,
        amount REAL NOT NULL, note TEXT NOT NULL DEFAULT '', day TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS loan_payments (
        id INTEGER PRIMARY KEY NOT NULL, loan_id INTEGER NOT NULL, amount REAL NOT NULL,
        day TEXT NOT NULL, created_at TEXT NOT NULL
      );
    `);
  }
  if (version < 3) {
    db.execSync(`
      CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY NOT NULL, category TEXT NOT NULL DEFAULT '', amount REAL NOT NULL, UNIQUE (category)
      );
    `);
  }
}

/** Create tables / run migrations. Idempotent; runs once per schema version. */
export function migrate(): void {
  createMetaTables();

  const row = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  if (version >= DATABASE_VERSION) return;

  db.execSync(`PRAGMA journal_mode = 'wal'`);

  if (version === 0) {
    // Fresh install → create the current schema directly. Preset categories are
    // NOT seeded here; they're seeded into a brand-new account on sign-up.
    createDataTables();
    version = 6;
  } else {
    if (version < 4) {
      // Existing pre-sync database (integer ids) → migrate its data to the
      // UUID + user_id schema. createDataTables() already includes receipt_path.
      ensureLegacyV3Shape(version);
      convertLegacyToV4();
      version = 4;
    }
    if (version === 4) {
      // v4 databases created before receipts existed need the column added.
      if (!hasColumn('transactions', 'receipt_path')) {
        db.execSync('ALTER TABLE transactions ADD COLUMN receipt_path TEXT');
      }
      version = 5;
    }
    if (version === 5) {
      // Introduce the people ledger and fold existing loans into it.
      createLedgerTable();
      migrateLoansToLedger();
      version = 6;
    }
  }

  db.execSync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

// --- Outbox -----------------------------------------------------------------

/** Queue a change for the next push. Only the latest op per row is kept. */
function enqueue(table: SyncTable, id: string, op: 'upsert' | 'delete', updatedAt: string): void {
  db.runSync('DELETE FROM sync_outbox WHERE table_name = ? AND row_id = ?', table, id);
  db.runSync(
    'INSERT INTO sync_outbox (table_name, row_id, op, updated_at) VALUES (?, ?, ?, ?)',
    table, id, op, updatedAt
  );
}

// --- Transactions -----------------------------------------------------------

export type TransactionInput = {
  type: EntryType;
  amount: number;
  category: string;
  note?: string;
  day?: string; // defaults to today
};

export function addTransaction(input: TransactionInput): string {
  const id = newId();
  const updatedAt = nowIso();
  db.runSync(
    `INSERT INTO transactions (id, user_id, type, amount, category, note, day, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, currentUserId ?? '', input.type, input.amount, input.category,
    input.note ?? '', input.day ?? todayKey(), updatedAt, updatedAt
  );
  enqueue('transactions', id, 'upsert', updatedAt);
  return id;
}

export function updateTransaction(id: string, input: TransactionInput): void {
  const updatedAt = nowIso();
  db.runSync(
    'UPDATE transactions SET type = ?, amount = ?, category = ?, note = ?, day = ?, updated_at = ? WHERE id = ?',
    input.type, input.amount, input.category, input.note ?? '', input.day ?? todayKey(), updatedAt, id
  );
  enqueue('transactions', id, 'upsert', updatedAt);
}

export function deleteTransaction(id: string): void {
  db.runSync('DELETE FROM transactions WHERE id = ?', id);
  enqueue('transactions', id, 'delete', nowIso());
}

/** Attach (or clear, with null) the Supabase Storage path of a receipt image. */
export function setTransactionReceipt(id: string, path: string | null): void {
  const updatedAt = nowIso();
  db.runSync('UPDATE transactions SET receipt_path = ?, updated_at = ? WHERE id = ?', path, updatedAt, id);
  enqueue('transactions', id, 'upsert', updatedAt);
}

export function getTransaction(id: string): Transaction | null {
  return db.getFirstSync<Transaction>('SELECT * FROM transactions WHERE id = ?', id);
}

/** Entries for a single day, newest first. */
export function getTransactionsByDay(day: string): Transaction[] {
  return db.getAllSync<Transaction>(
    'SELECT * FROM transactions WHERE day = ? ORDER BY created_at DESC',
    day
  );
}

/** Every entry, newest day first (for the History screen). */
export function getAllTransactions(): Transaction[] {
  return db.getAllSync<Transaction>(
    'SELECT * FROM transactions ORDER BY day DESC, created_at DESC'
  );
}

// --- Aggregates -------------------------------------------------------------

/** In/out/net totals for an inclusive day-key range. */
export function getTotals(startDay: string, endDay: string): Totals {
  const row = db.getFirstSync<{ income: number; expense: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'in'  THEN amount END), 0) AS income,
       COALESCE(SUM(CASE WHEN type = 'out' THEN amount END), 0) AS expense
     FROM transactions
     WHERE day BETWEEN ? AND ?`,
    startDay,
    endDay
  );
  const income = row?.income ?? 0;
  const expense = row?.expense ?? 0;
  return { income, expense, net: income - expense };
}

/** Per-category totals for one direction (in/out) within a range. */
export function getCategoryBreakdown(
  startDay: string,
  endDay: string,
  type: EntryType
): CategorySlice[] {
  return db.getAllSync<CategorySlice>(
    `SELECT category, SUM(amount) AS total, COUNT(*) AS count
     FROM transactions
     WHERE type = ? AND day BETWEEN ? AND ?
     GROUP BY category
     ORDER BY total DESC`,
    type,
    startDay,
    endDay
  );
}

/** Headline stats for an inclusive day-key range (for the advanced report). */
export type ReportStats = {
  income: number;
  expense: number;
  net: number;
  count: number;
  spendDays: number; // distinct days that had spending
  avgPerDay: number; // expense / spendDays
};

export function getReportStats(startDay: string, endDay: string): ReportStats {
  const row = db.getFirstSync<{ income: number; expense: number; count: number; spendDays: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'in'  THEN amount END), 0) AS income,
       COALESCE(SUM(CASE WHEN type = 'out' THEN amount END), 0) AS expense,
       COUNT(*) AS count,
       COUNT(DISTINCT CASE WHEN type = 'out' THEN day END) AS spendDays
     FROM transactions
     WHERE day BETWEEN ? AND ?`,
    startDay,
    endDay
  );
  const income = row?.income ?? 0;
  const expense = row?.expense ?? 0;
  const spendDays = row?.spendDays ?? 0;
  return {
    income,
    expense,
    net: income - expense,
    count: row?.count ?? 0,
    spendDays,
    avgPerDay: spendDays > 0 ? expense / spendDays : 0,
  };
}

/** In/out per calendar month within a range (for the trend chart). */
export type MonthTotal = { month: string; income: number; expense: number };

export function getMonthlyTotals(startDay: string, endDay: string): MonthTotal[] {
  return db.getAllSync<MonthTotal>(
    `SELECT substr(day, 1, 7) AS month,
       COALESCE(SUM(CASE WHEN type = 'in'  THEN amount END), 0) AS income,
       COALESCE(SUM(CASE WHEN type = 'out' THEN amount END), 0) AS expense
     FROM transactions
     WHERE day BETWEEN ? AND ?
     GROUP BY month
     ORDER BY month ASC`,
    startDay,
    endDay
  );
}

/** The largest entries of one direction in a range (biggest expenses/incomes). */
export function getTopTransactions(
  startDay: string,
  endDay: string,
  type: EntryType,
  limit: number
): Transaction[] {
  return db.getAllSync<Transaction>(
    'SELECT * FROM transactions WHERE type = ? AND day BETWEEN ? AND ? ORDER BY amount DESC LIMIT ?',
    type,
    startDay,
    endDay,
    limit
  );
}

/** Per-day in/out within a range, with empty days filled as zero. */
export function getDailyTotals(startDay: string, endDay: string): DayTotal[] {
  const rows = db.getAllSync<{ day: string; income: number; expense: number }>(
    `SELECT day,
       COALESCE(SUM(CASE WHEN type = 'in'  THEN amount END), 0) AS income,
       COALESCE(SUM(CASE WHEN type = 'out' THEN amount END), 0) AS expense
     FROM transactions
     WHERE day BETWEEN ? AND ?
     GROUP BY day`,
    startDay,
    endDay
  );
  return rows;
}

// --- Categories -------------------------------------------------------------

export function getCategories(type?: EntryType): Category[] {
  if (type) {
    return db.getAllSync<Category>(
      'SELECT * FROM categories WHERE type = ? ORDER BY sort ASC, name ASC',
      type
    );
  }
  return db.getAllSync<Category>('SELECT * FROM categories ORDER BY sort ASC, name ASC');
}

export function hasAnyCategories(): boolean {
  const row = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM categories');
  return (row?.n ?? 0) > 0;
}

/**
 * Add a custom category (or return the existing one with the same name+type).
 * Returns the category name so callers can select it immediately.
 */
export function addCategory(name: string, emoji: string, type: EntryType): string {
  const trimmed = name.trim();
  const existing = db.getFirstSync<{ id: string }>(
    'SELECT id FROM categories WHERE name = ? AND type = ?',
    trimmed, type
  );
  if (existing) return trimmed;

  const id = newId();
  const updatedAt = nowIso();
  db.runSync(
    `INSERT INTO categories (id, user_id, name, emoji, type, is_preset, sort, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 999, ?)`,
    id, currentUserId ?? '', trimmed, emoji, type, updatedAt
  );
  enqueue('categories', id, 'upsert', updatedAt);
  return trimmed;
}

// --- Loans ------------------------------------------------------------------
// A loan's status is derived from its repayments: it is settled once the
// recorded repayments cover the full amount. "Mark as settled" simply records
// the remaining balance as a repayment, so payments stay the single source of
// truth (and deleting one reopens the loan).

/** What's still unpaid on a loan (never negative). */
export function loanRemaining(loan: Pick<Loan, 'amount' | 'repaid'>): number {
  return Math.max(0, loan.amount - loan.repaid);
}

/** Fully repaid (with a small tolerance for floating-point cents). */
export function isLoanSettled(loan: Pick<Loan, 'amount' | 'repaid'>): boolean {
  return loan.repaid >= loan.amount - 0.005;
}

export type LoanInput = {
  direction: LoanDirection;
  person: string;
  amount: number;
  note?: string;
  day?: string; // defaults to today
};

export function addLoan(input: LoanInput): string {
  const id = newId();
  const updatedAt = nowIso();
  db.runSync(
    `INSERT INTO loans (id, user_id, direction, person, amount, note, day, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, currentUserId ?? '', input.direction, input.person.trim(), input.amount,
    input.note ?? '', input.day ?? todayKey(), updatedAt, updatedAt
  );
  enqueue('loans', id, 'upsert', updatedAt);
  return id;
}

export function updateLoan(id: string, input: LoanInput): void {
  const updatedAt = nowIso();
  db.runSync(
    'UPDATE loans SET direction = ?, person = ?, amount = ?, note = ?, day = ?, updated_at = ? WHERE id = ?',
    input.direction, input.person.trim(), input.amount, input.note ?? '', input.day ?? todayKey(), updatedAt, id
  );
  enqueue('loans', id, 'upsert', updatedAt);
}

/** Removes the loan and its repayment history. */
export function deleteLoan(id: string): void {
  const payments = db.getAllSync<{ id: string }>(
    'SELECT id FROM loan_payments WHERE loan_id = ?',
    id
  );
  db.runSync('DELETE FROM loan_payments WHERE loan_id = ?', id);
  db.runSync('DELETE FROM loans WHERE id = ?', id);
  const stamp = nowIso();
  for (const p of payments) enqueue('loan_payments', p.id, 'delete', stamp);
  enqueue('loans', id, 'delete', stamp);
}

export function getLoan(id: string): Loan | null {
  return db.getFirstSync<Loan>(
    `SELECT l.*, COALESCE(SUM(p.amount), 0) AS repaid
     FROM loans l
     LEFT JOIN loan_payments p ON p.loan_id = l.id
     WHERE l.id = ?
     GROUP BY l.id`,
    id
  );
}

/** All loans with their repaid totals: open first, then newest first. */
export function getLoans(): Loan[] {
  return db.getAllSync<Loan>(
    `SELECT l.*, COALESCE(SUM(p.amount), 0) AS repaid
     FROM loans l
     LEFT JOIN loan_payments p ON p.loan_id = l.id
     GROUP BY l.id
     ORDER BY (COALESCE(SUM(p.amount), 0) >= l.amount) ASC, l.day DESC, l.created_at DESC`
  );
}

export function addLoanPayment(loanId: string, amount: number, day?: string): string {
  const id = newId();
  const updatedAt = nowIso();
  db.runSync(
    `INSERT INTO loan_payments (id, user_id, loan_id, amount, day, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, currentUserId ?? '', loanId, amount, day ?? todayKey(), updatedAt, updatedAt
  );
  enqueue('loan_payments', id, 'upsert', updatedAt);
  return id;
}

export function deleteLoanPayment(id: string): void {
  db.runSync('DELETE FROM loan_payments WHERE id = ?', id);
  enqueue('loan_payments', id, 'delete', nowIso());
}

/** Repayments for one loan, newest first. */
export function getLoanPayments(loanId: string): LoanPayment[] {
  return db.getAllSync<LoanPayment>(
    'SELECT * FROM loan_payments WHERE loan_id = ? ORDER BY day DESC, created_at DESC',
    loanId
  );
}

/** Outstanding totals across open loans, per direction. */
export function getLoanTotals(): LoanTotals {
  const row = db.getFirstSync<{ owedToMe: number; iOwe: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 'given' THEN remaining END), 0) AS owedToMe,
       COALESCE(SUM(CASE WHEN direction = 'taken' THEN remaining END), 0) AS iOwe
     FROM (
       SELECT l.direction,
              MAX(l.amount - COALESCE(
                (SELECT SUM(p.amount) FROM loan_payments p WHERE p.loan_id = l.id), 0
              ), 0) AS remaining
       FROM loans l
     )`
  );
  return { owedToMe: row?.owedToMe ?? 0, iOwe: row?.iOwe ?? 0 };
}

// --- Budgets ----------------------------------------------------------------
// Budgets are monthly limits on spending ('out' entries only). One row per
// category, plus an optional overall row (category = OVERALL_BUDGET).

/** Set a monthly limit; zero or less removes it. */
export function setBudget(category: string, amount: number): void {
  const existing = db.getFirstSync<{ id: string }>(
    'SELECT id FROM budgets WHERE category = ?',
    category
  );

  if (amount <= 0) {
    if (existing) {
      db.runSync('DELETE FROM budgets WHERE id = ?', existing.id);
      enqueue('budgets', existing.id, 'delete', nowIso());
    }
    return;
  }

  const updatedAt = nowIso();
  if (existing) {
    db.runSync('UPDATE budgets SET amount = ?, updated_at = ? WHERE id = ?', amount, updatedAt, existing.id);
    enqueue('budgets', existing.id, 'upsert', updatedAt);
  } else {
    const id = newId();
    db.runSync(
      'INSERT INTO budgets (id, user_id, category, amount, updated_at) VALUES (?, ?, ?, ?, ?)',
      id, currentUserId ?? '', category, amount, updatedAt
    );
    enqueue('budgets', id, 'upsert', updatedAt);
  }
}

/** All budgets: overall first, then categories alphabetically. */
export function getBudgets(): Budget[] {
  return db.getAllSync<Budget>(
    "SELECT * FROM budgets ORDER BY (category = '') DESC, category ASC"
  );
}

/** Each budget with its spend in the given range (usually one month). */
export function getBudgetProgress(startDay: string, endDay: string): BudgetProgress[] {
  return db.getAllSync<BudgetProgress>(
    `SELECT b.category, b.amount AS budget,
       COALESCE((
         SELECT SUM(t.amount) FROM transactions t
         WHERE t.type = 'out' AND t.day BETWEEN ? AND ?
           AND (b.category = '' OR t.category = b.category)
       ), 0) AS spent
     FROM budgets b
     ORDER BY (b.category = '') DESC, b.category ASC`,
    startDay,
    endDay
  );
}

/** Danger zone: wipe all entries (categories are kept). */
export function clearAllTransactions(): void {
  const ids = db.getAllSync<{ id: string }>('SELECT id FROM transactions');
  db.execSync('DELETE FROM transactions');
  const stamp = nowIso();
  for (const t of ids) enqueue('transactions', t.id, 'delete', stamp);
}

// --- People ledger ----------------------------------------------------------

export type LedgerInput = {
  person: string;
  direction: LedgerDirection;
  amount: number;
  note?: string;
  day?: string; // defaults to today
};

export function addLedgerEntry(input: LedgerInput): string {
  const id = newId();
  const updatedAt = nowIso();
  db.runSync(
    `INSERT INTO ledger_entries (id, user_id, person, direction, amount, note, day, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, currentUserId ?? '', input.person.trim(), input.direction, input.amount,
    input.note ?? '', input.day ?? todayKey(), updatedAt, updatedAt
  );
  enqueue('ledger_entries', id, 'upsert', updatedAt);
  return id;
}

export function updateLedgerEntry(id: string, input: LedgerInput): void {
  const updatedAt = nowIso();
  db.runSync(
    'UPDATE ledger_entries SET person = ?, direction = ?, amount = ?, note = ?, day = ?, updated_at = ? WHERE id = ?',
    input.person.trim(), input.direction, input.amount, input.note ?? '', input.day ?? todayKey(), updatedAt, id
  );
  enqueue('ledger_entries', id, 'upsert', updatedAt);
}

export function deleteLedgerEntry(id: string): void {
  db.runSync('DELETE FROM ledger_entries WHERE id = ?', id);
  enqueue('ledger_entries', id, 'delete', nowIso());
}

export function getLedgerEntry(id: string): LedgerEntry | null {
  return db.getFirstSync<LedgerEntry>('SELECT * FROM ledger_entries WHERE id = ?', id);
}

/** Every person with their rolled-up balance, most recently active first. */
export function getPeople(): PersonBalance[] {
  return db.getAllSync<PersonBalance>(
    `SELECT person,
       SUM(CASE WHEN direction = 'gave' THEN amount ELSE -amount END) AS balance,
       COUNT(*) AS entries,
       MAX(day) AS lastDay
     FROM ledger_entries
     GROUP BY person
     ORDER BY lastDay DESC, person ASC`
  );
}

/** All entries with one person, newest first. */
export function getPersonEntries(person: string): LedgerEntry[] {
  return db.getAllSync<LedgerEntry>(
    'SELECT * FROM ledger_entries WHERE person = ? ORDER BY day DESC, created_at DESC',
    person
  );
}

/** One person's net balance (>0 they owe you, <0 you owe them). */
export function getPersonBalance(person: string): number {
  const row = db.getFirstSync<{ balance: number }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'gave' THEN amount ELSE -amount END), 0) AS balance
     FROM ledger_entries WHERE person = ?`,
    person
  );
  return row?.balance ?? 0;
}

/** How much you gave / took across people within a day range (for the dashboard). */
export function getLedgerPeriodTotals(startDay: string, endDay: string): { gave: number; took: number } {
  const row = db.getFirstSync<{ gave: number; took: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 'gave' THEN amount END), 0) AS gave,
       COALESCE(SUM(CASE WHEN direction = 'took' THEN amount END), 0) AS took
     FROM ledger_entries
     WHERE day BETWEEN ? AND ?`,
    startDay,
    endDay
  );
  return { gave: row?.gave ?? 0, took: row?.took ?? 0 };
}

/** Total receivable / payable across everyone. */
export function getLedgerTotals(): LedgerTotals {
  const row = db.getFirstSync<{ receivable: number; payable: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN balance > 0 THEN balance END), 0) AS receivable,
       COALESCE(SUM(CASE WHEN balance < 0 THEN -balance END), 0) AS payable
     FROM (
       SELECT SUM(CASE WHEN direction = 'gave' THEN amount ELSE -amount END) AS balance
       FROM ledger_entries GROUP BY person
     )`
  );
  return { receivable: row?.receivable ?? 0, payable: row?.payable ?? 0 };
}

// --- Account setup ----------------------------------------------------------

/** The account currently owning this device's local data (from sync_state). */
export function getLocalUserId(): string | null {
  const row = db.getFirstSync<{ user_id: string | null }>(
    'SELECT user_id FROM sync_state WHERE id = 1'
  );
  return row?.user_id ?? null;
}

export function setLocalUserId(userId: string | null): void {
  db.runSync('UPDATE sync_state SET user_id = ? WHERE id = 1', userId);
}

export function getSyncCursor(): string | null {
  const row = db.getFirstSync<{ last_pulled_at: string | null }>(
    'SELECT last_pulled_at FROM sync_state WHERE id = 1'
  );
  return row?.last_pulled_at ?? null;
}

export function setSyncCursor(cursor: string | null): void {
  db.runSync('UPDATE sync_state SET last_pulled_at = ? WHERE id = 1', cursor);
}

/**
 * Erase this device's local data. Used when a different account signs in on a
 * device that already holds someone else's data.
 */
export function wipeLocalData(): void {
  db.withTransactionSync(() => {
    for (const table of SYNC_TABLES) db.execSync(`DELETE FROM ${table}`);
    db.execSync('DELETE FROM sync_outbox');
    db.runSync('UPDATE sync_state SET user_id = NULL, last_pulled_at = NULL WHERE id = 1');
  });
  notifyDbChanged();
}

/**
 * Claim any unassigned local rows (user_id = '') for an account and queue them
 * for upload. Covers data created before sync existed, so it isn't lost.
 */
export function adoptUnassignedData(userId: string): void {
  const stamp = nowIso();
  db.withTransactionSync(() => {
    for (const table of SYNC_TABLES) {
      const rows = db.getAllSync<{ id: string }>(
        `SELECT id FROM ${table} WHERE user_id = ''`
      );
      if (rows.length === 0) continue;
      db.runSync(`UPDATE ${table} SET user_id = ?, updated_at = ? WHERE user_id = ''`, userId, stamp);
      for (const r of rows) enqueue(table as SyncTable, r.id, 'upsert', stamp);
    }
  });
}

/** Seed the preset categories into a brand-new account and queue them for upload. */
export function seedPresets(userId: string): void {
  const stamp = nowIso();
  db.withTransactionSync(() => {
    PRESET_CATEGORIES.forEach((cat, index) => {
      const id = newId();
      db.runSync(
        `INSERT OR IGNORE INTO categories (id, user_id, name, emoji, type, is_preset, sort, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        id, userId, cat.name, cat.emoji, cat.type, index, stamp
      );
      enqueue('categories', id, 'upsert', stamp);
    });
  });
  notifyDbChanged();
}

/**
 * Add any preset categories the account is missing (matched by name + type),
 * appended after the existing ones. Idempotent, so it's safe to introduce new
 * presets in an app update and have existing accounts pick them up once.
 * Returns how many were added.
 */
export function seedMissingPresets(userId: string): number {
  const stamp = nowIso();
  let added = 0;
  db.withTransactionSync(() => {
    const existing = db.getAllSync<{ name: string; type: string }>(
      'SELECT name, type FROM categories'
    );
    const have = new Set(existing.map((c) => `${c.type}:${c.name.trim().toLowerCase()}`));
    const base = db.getFirstSync<{ next: number }>(
      'SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM categories'
    );
    let sort = base?.next ?? 0;
    for (const cat of PRESET_CATEGORIES) {
      if (have.has(`${cat.type}:${cat.name.trim().toLowerCase()}`)) continue;
      const id = newId();
      db.runSync(
        `INSERT OR IGNORE INTO categories (id, user_id, name, emoji, type, is_preset, sort, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        id, userId, cat.name, cat.emoji, cat.type, sort++, stamp
      );
      enqueue('categories', id, 'upsert', stamp);
      added++;
    }
  });
  if (added > 0) notifyDbChanged();
  return added;
}

// --- Sync apply -------------------------------------------------------------
// Used only by the sync engine to write rows pulled from the server. These do
// NOT touch the outbox (pulled changes must not be re-uploaded) and use
// last-write-wins: a remote row is applied only if it's newer than the local one.

type RemoteRow = Record<string, any> & { id: string; updated_at: string; deleted?: boolean };

function localUpdatedAt(table: SyncTable, id: string): string | null {
  const row = db.getFirstSync<{ updated_at: string }>(
    `SELECT updated_at FROM ${table} WHERE id = ?`,
    id
  );
  return row?.updated_at ?? null;
}

function remoteIsNewer(table: SyncTable, id: string, remoteUpdatedAt: string): boolean {
  const local = localUpdatedAt(table, id);
  if (!local) return true;
  return new Date(remoteUpdatedAt).getTime() >= new Date(local).getTime();
}

/** Apply a batch of pulled rows for a table, resolving conflicts by last-write-wins. */
export function applyRemoteRows(table: SyncTable, rows: RemoteRow[]): void {
  if (rows.length === 0) return;
  const cols = columnsFor(table);
  const placeholders = cols.map(() => '?').join(', ');

  db.withTransactionSync(() => {
    for (const row of rows) {
      // A queued local change for this row wins until it's been pushed, so a
      // background pull can never clobber an edit that hasn't synced yet.
      const pending = db.getFirstSync(
        'SELECT 1 AS x FROM sync_outbox WHERE table_name = ? AND row_id = ?',
        table, row.id
      );
      if (pending) continue;

      if (row.deleted) {
        db.runSync(`DELETE FROM ${table} WHERE id = ?`, row.id);
        continue;
      }
      if (!remoteIsNewer(table, row.id, row.updated_at)) continue;
      const values = cols.map((c) => row[c]);
      // INSERT OR REPLACE (not ON CONFLICT id) so a remote row also wins over a
      // local row that clashes on a secondary UNIQUE key — e.g. the same
      // category name created on two devices before they synced.
      db.runSync(
        `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`,
        ...values
      );
    }
  });
  notifyDbChanged();
}

/** The rows currently queued for upload, oldest first. */
export type OutboxEntry = { seq: number; table_name: SyncTable; row_id: string; op: 'upsert' | 'delete' };

export function getOutbox(): OutboxEntry[] {
  return db.getAllSync<OutboxEntry>(
    'SELECT seq, table_name, row_id, op FROM sync_outbox ORDER BY seq ASC'
  );
}

/** Read a single row as a plain object for upload, or null if it's gone. */
export function getRowForUpload(table: SyncTable, id: string): Record<string, any> | null {
  return db.getFirstSync<Record<string, any>>(`SELECT * FROM ${table} WHERE id = ?`, id);
}

export function removeOutboxEntry(seq: number): void {
  db.runSync('DELETE FROM sync_outbox WHERE seq = ?', seq);
}

// Ensure the schema exists before any query runs (idempotent).
try {
  migrate();
} catch (e) {
  dbInitError = e instanceof Error ? e.message : String(e);
}
