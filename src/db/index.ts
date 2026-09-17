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
  gave: number; // total you handed over
  took: number; // total you received
  entries: number;
  lastDay: string;
  pinned: number; // 1 = kept at the top of the people list
  archived: number; // 1 = hidden from the main list
};

/** Per-person display flags. Stored in their own synced table (see person_flags). */
export type PersonFlags = {
  pinned: boolean;
  archived: boolean;
};

/** Totals across everyone. */
export type LedgerTotals = {
  receivable: number; // sum of positive balances
  payable: number; // sum of |negative balances|
};

// --- Shared books -----------------------------------------------------------
// A shared book is one ledger two accounts both read and both write.
//
// An entry records WHO PAID, never "gave"/"took": gave/took is relative to
// whoever is looking, so it would mean opposite things on the two phones.
// `payer_id` is absolute, so both devices hold the identical row and each one
// works out the sign for its own user. See supabase/shared-books.sql.

export type SharedBook = {
  id: string;
  name: string;
  owner_id: string;
  join_code: string | null;
  code_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SharedMember = {
  id: string;
  book_id: string;
  user_id: string;
  joined_at: string;
};

export type SharedEntry = {
  id: string;
  book_id: string;
  author_id: string; // who typed it in
  payer_id: string; // who actually handed over the money
  amount: number;
  note: string;
  day: string;
  created_at: string;
  updated_at: string;
};

/** A shared book rolled up for the people list. */
export type SharedBookSummary = {
  id: string;
  name: string;
  /** The other member's id, or null while you're the only one in the book. */
  otherUserId: string | null;
  otherName: string | null;
  balance: number; // >0 they owe you, <0 you owe them
  gave: number; // total you paid
  took: number; // total they paid
  entries: number;
  lastDay: string;
  pinned: number; // 1 = kept at the top of the people list
  archived: number; // 1 = hidden from the main list
  /** True while nobody has redeemed the join code yet. */
  pending: boolean;
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
  'person_flags',
] as const;

export type SyncTable = (typeof SYNC_TABLES)[number];

/**
 * Tables belonging to shared books. They are scoped by MEMBERSHIP rather than
 * by owner, so they can't join SYNC_TABLES — that list's queries all assume a
 * `user_id` column naming a single owner. They sync on their own lane with
 * their own cursor; see sync/engine.ts.
 *
 * Only `shared_entries` is ever pushed. Creating a book, joining one and
 * rotating a code all run as server-side functions, so there is nothing else
 * for a client to upload — which also means one less way to trip over RLS.
 */
export const SHARED_TABLES = ['shared_books', 'shared_book_members', 'shared_entries'] as const;

export type SharedTable = (typeof SHARED_TABLES)[number];

export type AnyTable = SyncTable | SharedTable;

export const SHARED_TABLE_COLUMNS: Record<SharedTable, string[]> = {
  shared_books: ['name', 'owner_id', 'join_code', 'code_expires_at', 'created_at'],
  shared_book_members: ['book_id', 'user_id', 'joined_at'],
  shared_entries: ['book_id', 'author_id', 'payer_id', 'amount', 'note', 'day', 'created_at'],
};

export function isSharedTable(table: AnyTable): table is SharedTable {
  return (SHARED_TABLES as readonly string[]).includes(table);
}

/** Data columns per table (excludes the common id / user_id / updated_at). */
export const TABLE_COLUMNS: Record<SyncTable, string[]> = {
  categories: ['name', 'emoji', 'type', 'is_preset', 'sort'],
  transactions: ['type', 'amount', 'category', 'note', 'day', 'created_at', 'receipt_path'],
  loans: ['direction', 'person', 'amount', 'note', 'day', 'created_at'],
  loan_payments: ['loan_id', 'amount', 'day', 'created_at'],
  budgets: ['category', 'amount'],
  ledger_entries: ['person', 'direction', 'amount', 'note', 'day', 'created_at'],
  person_flags: ['person', 'pinned', 'archived'],
};

/**
 * All columns for a table, in a stable order (id first, updated_at last).
 * Shared tables have no single owner, so they carry no `user_id` of their own.
 */
export function columnsFor(table: AnyTable): string[] {
  if (isSharedTable(table)) return ['id', ...SHARED_TABLE_COLUMNS[table], 'updated_at'];
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

const DATABASE_VERSION = 8;

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

  // Shared books pull on their own lane, so they need their own cursor. Added
  // here rather than in a versioned step because createMetaTables() runs before
  // the version check — the outbox must exist even when migrate() early-returns.
  if (!hasColumn('sync_state', 'shared_pulled_at')) {
    db.execSync('ALTER TABLE sync_state ADD COLUMN shared_pulled_at TEXT');
  }
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
  createPersonFlagsTable();
  createSharedTables();
}

/**
 * The shared-book tables (also created on their own for the v7 → v8 upgrade).
 *
 * `shared_profiles` is a local-only cache of who the other member is — names
 * live in `public.profiles` on the server, and copying them down means an
 * entry still says "Bilal paid" rather than a bare uuid while offline.
 */
function createSharedTables(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS shared_books (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL,
      join_code TEXT,
      code_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shared_book_members (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (book_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS shared_entries (
      id TEXT PRIMARY KEY NOT NULL,
      book_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      payer_id TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      day TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shared_entries_book ON shared_entries(book_id);

    CREATE TABLE IF NOT EXISTS shared_profiles (
      user_id TEXT PRIMARY KEY NOT NULL,
      name TEXT,
      email TEXT,
      updated_at TEXT NOT NULL
    );
  `);
}

/**
 * Per-person pin / archive flags (also created on its own for the v6 → v7
 * upgrade). There is no "people" table — a person is just a name that appears
 * in `ledger_entries` — so this holds the extra state a person can carry.
 *
 * The id is derived from the name rather than random, so two devices that pin
 * the same person independently produce the SAME row instead of duplicates.
 */
function createPersonFlagsTable(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS person_flags (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      person TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      UNIQUE (person)
    );
  `);
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
    version = 8;
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
    if (version === 6) {
      // Introduce per-person pin / archive flags. Nothing to backfill — no
      // flags means "not pinned, not archived", which is the old behaviour.
      createPersonFlagsTable();
      version = 7;
    }
    if (version === 7) {
      // Introduce shared books. Empty until the user creates or joins one, so
      // again there's nothing to backfill.
      createSharedTables();
      version = 8;
    }
  }

  db.execSync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

// --- Outbox -----------------------------------------------------------------

/** Queue a change for the next push. Only the latest op per row is kept. */
function enqueue(table: AnyTable, id: string, op: 'upsert' | 'delete', updatedAt: string): void {
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

/** Change a category's icon. Presets can be re-iconed too. */
export function updateCategoryEmoji(id: string, emoji: string): void {
  const updatedAt = nowIso();
  db.runSync(
    'UPDATE categories SET emoji = ?, updated_at = ? WHERE id = ?',
    emoji, updatedAt, id
  );
  enqueue('categories', id, 'upsert', updatedAt);
}

/**
 * Rename a category, carrying its entries and budget across with it.
 *
 * Entries and budgets reference a category by *name*, not id, so the rename has
 * to cascade or the history would detach from the category it belongs to.
 * Returns 'duplicate' if another category of the same type already owns the
 * name, so callers can tell the user instead of silently doing nothing.
 */
export function renameCategory(id: string, name: string): 'ok' | 'empty' | 'duplicate' {
  const trimmed = name.trim();
  if (!trimmed) return 'empty';

  const cat = db.getFirstSync<Category>('SELECT * FROM categories WHERE id = ?', id);
  if (!cat) return 'empty';
  if (cat.name === trimmed) return 'ok';

  const clash = db.getFirstSync<{ id: string }>(
    'SELECT id FROM categories WHERE name = ? AND type = ? AND id <> ?',
    trimmed, cat.type, id
  );
  if (clash) return 'duplicate';

  const updatedAt = nowIso();
  db.withTransactionSync(() => {
    db.runSync(
      'UPDATE categories SET name = ?, updated_at = ? WHERE id = ?',
      trimmed, updatedAt, id
    );
    enqueue('categories', id, 'upsert', updatedAt);

    // Entries of the same direction that carried the old name.
    const moved = db.getAllSync<{ id: string }>(
      'SELECT id FROM transactions WHERE category = ? AND type = ?',
      cat.name, cat.type
    );
    db.runSync(
      'UPDATE transactions SET category = ?, updated_at = ? WHERE category = ? AND type = ?',
      trimmed, updatedAt, cat.name, cat.type
    );
    for (const row of moved) enqueue('transactions', row.id, 'upsert', updatedAt);

    // Budgets cap spending only, and hold one row per category name.
    if (cat.type === 'out') {
      const old = db.getFirstSync<{ id: string }>(
        'SELECT id FROM budgets WHERE category = ?',
        cat.name
      );
      if (old) {
        const taken = db.getFirstSync<{ id: string }>(
          'SELECT id FROM budgets WHERE category = ?',
          trimmed
        );
        if (taken) {
          // A stray budget already sits under the new name; keep it and drop
          // the old row rather than trip the UNIQUE (category) constraint.
          db.runSync('DELETE FROM budgets WHERE id = ?', old.id);
          enqueue('budgets', old.id, 'delete', updatedAt);
        } else {
          db.runSync(
            'UPDATE budgets SET category = ?, updated_at = ? WHERE id = ?',
            trimmed, updatedAt, old.id
          );
          enqueue('budgets', old.id, 'upsert', updatedAt);
        }
      }
    }
  });
  return 'ok';
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

// --- Person flags (pin / archive) -------------------------------------------
// A person has no row of their own — they exist because their name appears in
// `ledger_entries`. `person_flags` hangs the extra per-person state off that
// name, with an id derived from the name so every device agrees on the row.

/**
 * Shared books get their pin / archive flags from `person_flags` too, under a
 * reserved key. A book isn't a person, but the flags are the same idea — your
 * own view of a row — and reusing the table means they sync to your other
 * devices for free instead of needing another table and another migration.
 *
 * The prefix can't collide with a real name: `createPerson` and `renamePerson`
 * both reject it, and `getPeople` / `findPerson` filter it out.
 */
export const BOOK_FLAG_PREFIX = '#book:';

export const bookFlagKey = (bookId: string): string => `${BOOK_FLAG_PREFIX}${bookId}`;

/** The stable row id for a person's flags. Derived, never random. */
function personFlagId(person: string): string {
  return `PF-${person.trim()}`;
}

/** Write one or both flags for a person, creating the row on first use. */
function setPersonFlags(person: string, patch: Partial<PersonFlags>): void {
  const name = person.trim();
  if (!name) return;

  const id = personFlagId(name);
  const updatedAt = nowIso();
  const current = getPersonFlags(name);
  const pinned = (patch.pinned ?? current.pinned) ? 1 : 0;
  const archived = (patch.archived ?? current.archived) ? 1 : 0;

  // Clear any stray row for the same person under a different id, so the
  // UNIQUE (person) constraint can never block the upsert below. Queue the
  // removal too, otherwise the next pull would just bring the stray back.
  const strays = db.getAllSync<{ id: string }>(
    'SELECT id FROM person_flags WHERE person = ? AND id <> ?',
    name, id
  );
  for (const stray of strays) {
    db.runSync('DELETE FROM person_flags WHERE id = ?', stray.id);
    enqueue('person_flags', stray.id, 'delete', updatedAt);
  }
  db.runSync(
    `INSERT INTO person_flags (id, user_id, person, pinned, archived, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       pinned = excluded.pinned,
       archived = excluded.archived,
       updated_at = excluded.updated_at`,
    id, currentUserId ?? '', name, pinned, archived, updatedAt
  );
  enqueue('person_flags', id, 'upsert', updatedAt);
}

/** Keep a person at the top of the people list (or stop doing so). */
export function setPersonPinned(person: string, pinned: boolean): void {
  setPersonFlags(person, { pinned });
}

/**
 * Hide a person from the main list. Archiving never deletes anything — their
 * entries and balance are untouched, they just move to the Archived view. A
 * person is also unpinned when archived, since the two make no sense together.
 */
export function setPersonArchived(person: string, archived: boolean): void {
  setPersonFlags(person, archived ? { archived: true, pinned: false } : { archived: false });
}

/** A person's current flags. Missing row = not pinned, not archived. */
export function getPersonFlags(person: string): PersonFlags {
  const row = db.getFirstSync<{ pinned: number; archived: number }>(
    'SELECT pinned, archived FROM person_flags WHERE person = ?',
    person.trim()
  );
  return { pinned: !!row?.pinned, archived: !!row?.archived };
}

/** Wipe every flags row for a name, remembering the deletes for the server. */
function dropPersonFlags(person: string, updatedAt: string): void {
  const rows = db.getAllSync<{ id: string }>(
    'SELECT id FROM person_flags WHERE person = ?',
    person
  );
  for (const row of rows) {
    db.runSync('DELETE FROM person_flags WHERE id = ?', row.id);
    enqueue('person_flags', row.id, 'delete', updatedAt);
  }
}

// --- People CRUD ------------------------------------------------------------
// A person is still just a name, so these work on the name across both tables:
// their entries in `ledger_entries` and their flags row in `person_flags`.

/**
 * The stored spelling of a name, ignoring case, or null if nobody goes by it.
 * Use this before creating or renaming so "Ali" and "ali" can't become two
 * people whose balances each tell half the story.
 */
export function findPerson(person: string): string | null {
  const name = person.trim();
  if (!name) return null;
  const row = db.getFirstSync<{ person: string }>(
    `SELECT person FROM (
       SELECT person FROM ledger_entries
       UNION
       SELECT person FROM person_flags WHERE person NOT LIKE '#book:%'
     ) WHERE person = ? COLLATE NOCASE
     LIMIT 1`,
    name
  );
  return row?.person ?? null;
}

/**
 * Put a name on the people list before any money changes hands. Backed by a
 * `person_flags` row, which is what makes an entry-less person exist at all.
 *
 * Throws if the name is blank or already taken, so the caller can show why.
 */
export function createPerson(person: string): string {
  const name = person.trim();
  if (!name) throw new Error('Enter a name.');
  if (name.startsWith(BOOK_FLAG_PREFIX)) throw new Error('That name isn’t allowed.');

  const existing = findPerson(name);
  if (existing) throw new Error(`${existing} is already on your list.`);

  setPersonFlags(name, {});
  notifyDbChanged();
  return name;
}

/**
 * Rename a person everywhere at once: every entry of theirs plus their flags.
 * Changing only the capitalisation is fine; taking someone else's name is not,
 * since that would silently merge two accounts into one.
 */
export function renamePerson(from: string, to: string): string {
  const oldName = from.trim();
  const newName = to.trim();
  if (!newName) throw new Error('Enter a name.');
  if (newName.startsWith(BOOK_FLAG_PREFIX)) throw new Error('That name isn’t allowed.');
  if (!oldName || oldName === newName) return newName;

  const clash = findPerson(newName);
  if (clash && clash.toLowerCase() !== oldName.toLowerCase()) {
    throw new Error(`${clash} is already on your list.`);
  }

  const flags = getPersonFlags(oldName);
  const updatedAt = nowIso();
  db.withTransactionSync(() => {
    const moved = db.getAllSync<{ id: string }>(
      'SELECT id FROM ledger_entries WHERE person = ?',
      oldName
    );
    db.runSync(
      'UPDATE ledger_entries SET person = ?, updated_at = ? WHERE person = ?',
      newName, updatedAt, oldName
    );
    for (const row of moved) enqueue('ledger_entries', row.id, 'upsert', updatedAt);

    // The flags id is derived from the name, so the row is replaced rather
    // than edited — otherwise the old id would linger and drag the old name
    // back on the next pull.
    dropPersonFlags(oldName, updatedAt);
    setPersonFlags(newName, flags);
  });
  notifyDbChanged();
  return newName;
}

/**
 * Remove a person and every entry of theirs, on this device and the server.
 * There is no undo — an outstanding balance just disappears — so callers are
 * expected to warn first (see the people screen).
 */
export function deletePerson(person: string): void {
  const name = person.trim();
  if (!name) return;

  const updatedAt = nowIso();
  db.withTransactionSync(() => {
    const entries = db.getAllSync<{ id: string }>(
      'SELECT id FROM ledger_entries WHERE person = ?',
      name
    );
    db.runSync('DELETE FROM ledger_entries WHERE person = ?', name);
    for (const entry of entries) enqueue('ledger_entries', entry.id, 'delete', updatedAt);
    dropPersonFlags(name, updatedAt);
  });
  notifyDbChanged();
}

/**
 * Every person with their rolled-up balance: pinned first, then most recently
 * active. Archived people are included — callers filter on `archived` so the
 * Archived view can be built from the same query.
 *
 * The names come from the ledger *and* from `person_flags`, so someone added
 * by hand shows up right away with an empty statement instead of waiting for
 * their first entry. Such a person has `entries: 0` and an empty `lastDay`,
 * and sorts to the top rather than the bottom — they were just added, so
 * that's where the user is looking for them.
 */
export function getPeople(): PersonBalance[] {
  return db.getAllSync<PersonBalance>(
    `SELECT p.person AS person,
       COALESCE(SUM(CASE WHEN e.direction = 'gave' THEN e.amount ELSE -e.amount END), 0) AS balance,
       COALESCE(SUM(CASE WHEN e.direction = 'gave' THEN e.amount END), 0) AS gave,
       COALESCE(SUM(CASE WHEN e.direction = 'took' THEN e.amount END), 0) AS took,
       COUNT(e.id) AS entries,
       COALESCE(MAX(e.day), '') AS lastDay,
       COALESCE(MAX(f.pinned), 0) AS pinned,
       COALESCE(MAX(f.archived), 0) AS archived
     FROM (
       SELECT person FROM ledger_entries
       UNION
       SELECT person FROM person_flags WHERE person NOT LIKE '#book:%'
     ) p
     LEFT JOIN ledger_entries e ON e.person = p.person
     LEFT JOIN person_flags f ON f.person = p.person
     GROUP BY p.person
     ORDER BY pinned DESC, COALESCE(MAX(e.day), '9999-99-99') DESC, person ASC`
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

/**
 * Total receivable / payable across everyone.
 *
 * Archived people are left out by default, so archiving someone actually takes
 * them off the headline figures. Pass `includeArchived` for the Archived view's
 * own totals.
 */
export function getLedgerTotals(options?: { includeArchived?: boolean }): LedgerTotals {
  const scope = options?.includeArchived
    ? ''
    : 'WHERE COALESCE(f.archived, 0) = 0';
  const row = db.getFirstSync<{ receivable: number; payable: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN balance > 0 THEN balance END), 0) AS receivable,
       COALESCE(SUM(CASE WHEN balance < 0 THEN -balance END), 0) AS payable
     FROM (
       SELECT SUM(CASE WHEN e.direction = 'gave' THEN e.amount ELSE -e.amount END) AS balance
       FROM ledger_entries e
       LEFT JOIN person_flags f ON f.person = e.person
       ${scope}
       GROUP BY e.person
     )`
  );
  return { receivable: row?.receivable ?? 0, payable: row?.payable ?? 0 };
}

// --- Shared books -----------------------------------------------------------
// Local mirror of the shared tables. Everything here is a plain read/write of
// the cache; getting the rows in and out of Supabase is sync/shared.ts's job.

/** Store a book pulled down or returned by create_book / join_book. */
export function upsertSharedBook(book: SharedBook): void {
  db.runSync(
    `INSERT OR REPLACE INTO shared_books
       (id, name, owner_id, join_code, code_expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    book.id, book.name ?? '', book.owner_id, book.join_code ?? null,
    book.code_expires_at ?? null, book.created_at, book.updated_at
  );
  notifyDbChanged();
}

export function getSharedBooks(): SharedBook[] {
  return db.getAllSync<SharedBook>('SELECT * FROM shared_books ORDER BY created_at DESC');
}

export function getSharedBook(id: string): SharedBook | null {
  return db.getFirstSync<SharedBook>('SELECT * FROM shared_books WHERE id = ?', id);
}

/** Forget a book locally — used after leaving one. */
export function deleteSharedBookLocally(id: string): void {
  const stamp = nowIso();
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM shared_entries WHERE book_id = ?', id);
    db.runSync('DELETE FROM shared_book_members WHERE book_id = ?', id);
    db.runSync('DELETE FROM shared_books WHERE id = ?', id);
    // Leave no orphan flags row behind to sync back and haunt the list.
    dropPersonFlags(bookFlagKey(id), stamp);
  });
  notifyDbChanged();
}

/** Record a membership row (yours or the other member's). */
export function upsertSharedMember(member: SharedMember & { updated_at?: string }): void {
  db.runSync(
    `INSERT OR REPLACE INTO shared_book_members (id, book_id, user_id, joined_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    member.id, member.book_id, member.user_id, member.joined_at,
    member.updated_at ?? nowIso()
  );
  notifyDbChanged();
}

export function getBookMembers(bookId: string): SharedMember[] {
  return db.getAllSync<SharedMember>(
    'SELECT * FROM shared_book_members WHERE book_id = ? ORDER BY joined_at ASC',
    bookId
  );
}

/** Cache a member's display name so entries read "Bilal paid" even offline. */
export function cacheSharedProfile(userId: string, name: string | null, email: string | null): void {
  db.runSync(
    'INSERT OR REPLACE INTO shared_profiles (user_id, name, email, updated_at) VALUES (?, ?, ?, ?)',
    userId, name, email, nowIso()
  );
}

/** Every member id across all books whose name we don't have yet. */
export function getUncachedMemberIds(): string[] {
  const rows = db.getAllSync<{ user_id: string }>(
    `SELECT DISTINCT m.user_id FROM shared_book_members m
     LEFT JOIN shared_profiles p ON p.user_id = m.user_id
     WHERE p.user_id IS NULL`
  );
  return rows.map((r) => r.user_id);
}

/** A member's best available label: their name, then their email, then null. */
export function getSharedMemberName(userId: string): string | null {
  const row = db.getFirstSync<{ name: string | null; email: string | null }>(
    'SELECT name, email FROM shared_profiles WHERE user_id = ?',
    userId
  );
  return row?.name?.trim() || row?.email?.trim() || null;
}

export type SharedEntryInput = {
  bookId: string;
  /** Who handed over the money — you, or the other member. */
  payerId: string;
  amount: number;
  note?: string;
  day?: string;
};

/**
 * Add an entry to a shared book. `author_id` is always you (the server enforces
 * that), while `payer_id` may be either member — that's how you record "he paid
 * for me" without needing him to be online.
 */
export function addSharedEntry(input: SharedEntryInput): string {
  const id = newId();
  const updatedAt = nowIso();
  db.runSync(
    `INSERT INTO shared_entries
       (id, book_id, author_id, payer_id, amount, note, day, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, input.bookId, currentUserId ?? '', input.payerId, input.amount,
    input.note ?? '', input.day ?? todayKey(), updatedAt, updatedAt
  );
  enqueue('shared_entries', id, 'upsert', updatedAt);
  return id;
}

export function updateSharedEntry(id: string, input: Omit<SharedEntryInput, 'bookId'>): void {
  const updatedAt = nowIso();
  db.runSync(
    `UPDATE shared_entries SET payer_id = ?, amount = ?, note = ?, day = ?, updated_at = ?
     WHERE id = ?`,
    input.payerId, input.amount, input.note ?? '', input.day ?? todayKey(), updatedAt, id
  );
  enqueue('shared_entries', id, 'upsert', updatedAt);
}

export function deleteSharedEntry(id: string): void {
  db.runSync('DELETE FROM shared_entries WHERE id = ?', id);
  enqueue('shared_entries', id, 'delete', nowIso());
}

export function getSharedEntry(id: string): SharedEntry | null {
  return db.getFirstSync<SharedEntry>('SELECT * FROM shared_entries WHERE id = ?', id);
}

/** A book's entries, newest first. */
export function getSharedEntries(bookId: string): SharedEntry[] {
  return db.getAllSync<SharedEntry>(
    'SELECT * FROM shared_entries WHERE book_id = ? ORDER BY day DESC, created_at DESC',
    bookId
  );
}

/**
 * What the book comes to for the signed-in user:
 *
 *   balance = Σ(you paid) − Σ(they paid)
 *
 * so it reads positive when you're owed. Both devices run this same sum over
 * the same rows and land on equal-and-opposite answers — which is the whole
 * reason entries store `payer_id` instead of "gave"/"took".
 */
export function getSharedBalance(bookId: string, userId: string): number {
  const row = db.getFirstSync<{ balance: number }>(
    `SELECT COALESCE(SUM(CASE WHEN payer_id = ? THEN amount ELSE -amount END), 0) AS balance
     FROM shared_entries WHERE book_id = ?`,
    userId, bookId
  );
  return row?.balance ?? 0;
}

/** Keep a shared book at the top of the people list (or stop doing so). */
export function setBookPinned(bookId: string, pinned: boolean): void {
  setPersonFlags(bookFlagKey(bookId), { pinned });
}

/** Hide a shared book from the main list. Nothing is deleted or left. */
export function setBookArchived(bookId: string, archived: boolean): void {
  setPersonFlags(
    bookFlagKey(bookId),
    archived ? { archived: true, pinned: false } : { archived: false }
  );
}

export function getBookFlags(bookId: string): PersonFlags {
  return getPersonFlags(bookFlagKey(bookId));
}

/** Rename a book locally. The server copy is updated by sync/shared.ts. */
export function renameSharedBookLocally(bookId: string, name: string): void {
  db.runSync(
    'UPDATE shared_books SET name = ?, updated_at = ? WHERE id = ?',
    name.trim(), nowIso(), bookId
  );
  notifyDbChanged();
}

/** Drop a book's flags — used when leaving, so nothing is left behind. */
export function clearBookFlags(bookId: string): void {
  dropPersonFlags(bookFlagKey(bookId), nowIso());
  notifyDbChanged();
}

/** Every shared book rolled up for the people list. */
export function getSharedBookSummaries(userId: string): SharedBookSummary[] {
  const books = db.getAllSync<{
    id: string;
    name: string;
    balance: number;
    gave: number;
    took: number;
    entries: number;
    lastDay: string | null;
  }>(
    `SELECT b.id AS id,
       b.name AS name,
       COALESCE(SUM(CASE WHEN e.payer_id = ? THEN e.amount ELSE -e.amount END), 0) AS balance,
       COALESCE(SUM(CASE WHEN e.payer_id = ? THEN e.amount END), 0) AS gave,
       COALESCE(SUM(CASE WHEN e.payer_id <> ? THEN e.amount END), 0) AS took,
       COUNT(e.id) AS entries,
       MAX(e.day) AS lastDay
     FROM shared_books b
     LEFT JOIN shared_entries e ON e.book_id = b.id
     GROUP BY b.id
     ORDER BY lastDay DESC, b.created_at DESC`,
    userId, userId, userId
  );

  return books.map((book) => {
    const other = db.getFirstSync<{ user_id: string }>(
      'SELECT user_id FROM shared_book_members WHERE book_id = ? AND user_id <> ? LIMIT 1',
      book.id, userId
    );
    const flags = getBookFlags(book.id);
    return {
      id: book.id,
      name: book.name,
      otherUserId: other?.user_id ?? null,
      otherName: other ? getSharedMemberName(other.user_id) : null,
      balance: book.balance,
      gave: book.gave,
      took: book.took,
      entries: book.entries,
      lastDay: book.lastDay ?? '',
      pinned: flags.pinned ? 1 : 0,
      archived: flags.archived ? 1 : 0,
      pending: !other,
    };
  });
}

/** The shared pull cursor. Separate from the personal one — different lane. */
export function getSharedCursor(): string | null {
  const row = db.getFirstSync<{ shared_pulled_at: string | null }>(
    'SELECT shared_pulled_at FROM sync_state WHERE id = 1'
  );
  return row?.shared_pulled_at ?? null;
}

export function setSharedCursor(cursor: string | null): void {
  db.runSync('UPDATE sync_state SET shared_pulled_at = ? WHERE id = 1', cursor);
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
    // Shared books belong to a membership, not to this device — a different
    // account signing in must not inherit the last user's shared ledgers.
    for (const table of SHARED_TABLES) db.execSync(`DELETE FROM ${table}`);
    db.execSync('DELETE FROM shared_profiles');
    db.execSync('DELETE FROM sync_outbox');
    db.runSync(
      `UPDATE sync_state
       SET user_id = NULL, last_pulled_at = NULL, shared_pulled_at = NULL
       WHERE id = 1`
    );
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

function localUpdatedAt(table: AnyTable, id: string): string | null {
  const row = db.getFirstSync<{ updated_at: string }>(
    `SELECT updated_at FROM ${table} WHERE id = ?`,
    id
  );
  return row?.updated_at ?? null;
}

function remoteIsNewer(table: AnyTable, id: string, remoteUpdatedAt: string): boolean {
  const local = localUpdatedAt(table, id);
  if (!local) return true;
  return new Date(remoteUpdatedAt).getTime() >= new Date(local).getTime();
}

/** Apply a batch of pulled rows for a table, resolving conflicts by last-write-wins. */
export function applyRemoteRows(table: AnyTable, rows: RemoteRow[]): void {
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
export type OutboxEntry = { seq: number; table_name: AnyTable; row_id: string; op: 'upsert' | 'delete' };

export function getOutbox(): OutboxEntry[] {
  return db.getAllSync<OutboxEntry>(
    'SELECT seq, table_name, row_id, op FROM sync_outbox ORDER BY seq ASC'
  );
}

/** Read a single row as a plain object for upload, or null if it's gone. */
export function getRowForUpload(table: AnyTable, id: string): Record<string, any> | null {
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
