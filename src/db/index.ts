import * as SQLite from 'expo-sqlite';

import { PRESET_CATEGORIES } from '@/constants/categories';
import { todayKey } from '@/lib/date';
import { DATA_CLOUD_DB, DATA_LOCAL_DB } from '@/sync/config';

export type EntryType = 'in' | 'out';

export type Transaction = {
  id: number;
  type: EntryType;
  amount: number;
  category: string;
  note: string;
  day: string; // 'YYYY-MM-DD' local
  created_at: string; // ISO timestamp
};

export type Category = {
  id: number;
  name: string;
  emoji: string;
  type: EntryType;
  is_preset: number;
  sort: number;
};

/** 'given' = I lent money (they owe me), 'taken' = I borrowed (I owe them). */
export type LoanDirection = 'given' | 'taken';

export type Loan = {
  id: number;
  direction: LoanDirection;
  person: string;
  amount: number;
  note: string;
  day: string; // 'YYYY-MM-DD' local
  created_at: string; // ISO timestamp
  repaid: number; // sum of recorded repayments
};

export type LoanPayment = {
  id: number;
  loan_id: number;
  amount: number;
  day: string;
  created_at: string;
};

/** Outstanding balances across all open loans. */
export type LoanTotals = {
  owedToMe: number; // remaining on loans I gave
  iOwe: number; // remaining on loans I took
};

/** Sentinel category for the overall (all-spending) monthly budget. */
export const OVERALL_BUDGET = '';

/** A monthly spending limit; category '' means all spending. */
export type Budget = {
  id: number;
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

/** A signed-in account. */
export type AuthUser = { id: number; email: string };

/**
 * Records the first fatal DB init/migration error. Surfaced by the app (see
 * auth-gate.tsx) so a failure shows a readable message instead of hanging on
 * the splash screen.
 */
let initError: string | null = null;
export function getDbInitError(): string | null {
  return initError;
}

function openLocal(name: string): SQLite.SQLiteDatabase {
  try {
    return SQLite.openDatabaseSync(name, { enableChangeListener: true });
  } catch {
    // Fall back without the change listener if the engine rejects it.
    return SQLite.openDatabaseSync(name);
  }
}

// The active connection for the whole app. Starts as the local, offline-only
// database; on a real build it is swapped for an embedded replica of the shared
// Turso database (see the "Cloud sync" section at the bottom of this file).
// `enableChangeListener` powers the live-refresh hook (see db/hooks.ts).
let db = openLocal(DATA_LOCAL_DB);

// The signed-in user. Every data row carries a `user_id`; all reads and writes
// below are scoped to this id, so one shared database keeps each user's data
// separate. Set by the sync provider after login; null when signed out.
let currentUserId: number | null = null;

export function getCurrentUserId(): number | null {
  return currentUserId;
}

export function setCurrentUserId(id: number | null): void {
  currentUserId = id;
  notifyDbChanged();
}

/** The signed-in user's id for writes; throws if somehow called signed out. */
function uid(): number {
  if (currentUserId == null) throw new Error('no_user');
  return currentUserId;
}

const DATABASE_VERSION = 4;

/** Create/upgrade tables. Runs once per schema version. */
export function migrate(): void {
  const row = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  if (version >= DATABASE_VERSION) return;

  if (version === 0) {
    db.execSync(`
      PRAGMA journal_mode = 'wal';

      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('in', 'out')),
        amount REAL NOT NULL,
        category TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        day TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_transactions_day ON transactions(day);

      CREATE TABLE categories (
        id INTEGER PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('in', 'out')),
        is_preset INTEGER NOT NULL DEFAULT 0,
        sort INTEGER NOT NULL DEFAULT 0,
        UNIQUE (name, type)
      );
    `);
    version = 1;
  }

  if (version === 1) {
    db.execSync(`
      CREATE TABLE loans (
        id INTEGER PRIMARY KEY NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('given', 'taken')),
        person TEXT NOT NULL,
        amount REAL NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        day TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE loan_payments (
        id INTEGER PRIMARY KEY NOT NULL,
        loan_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        day TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_loan_payments_loan ON loan_payments(loan_id);
    `);
    version = 2;
  }

  if (version === 2) {
    db.execSync(`
      CREATE TABLE budgets (
        id INTEGER PRIMARY KEY NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL,
        UNIQUE (category)
      );
    `);
    version = 3;
  }

  // v4: multi-user. A users table, plus a user_id on every data table so one
  // shared database holds every user's data, separated by id. categories and
  // budgets are recreated because their UNIQUE constraints must now include the
  // user. Any pre-v4 rows get user_id 0 (owned by nobody) and simply stop
  // showing — this feature starts each account fresh.
  if (version === 3) {
    db.execSync(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      ALTER TABLE transactions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE loans ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE loan_payments ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX idx_transactions_user ON transactions(user_id);
      CREATE INDEX idx_loans_user ON loans(user_id);

      DROP TABLE categories;
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY NOT NULL,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        emoji TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('in', 'out')),
        is_preset INTEGER NOT NULL DEFAULT 0,
        sort INTEGER NOT NULL DEFAULT 0,
        UNIQUE (user_id, name, type)
      );

      DROP TABLE budgets;
      CREATE TABLE budgets (
        id INTEGER PRIMARY KEY NOT NULL,
        user_id INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL,
        UNIQUE (user_id, category)
      );
    `);
    version = 4;
  }

  db.execSync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

// --- Auth (plain passwords, checked against the synced users table) ----------
// No hashing by design — see the app's threat model. Runs against the local
// replica, so login works offline once the users table has synced at least once.

export function signupUser(email: string, password: string): AuthUser {
  const e = email.trim().toLowerCase();
  if (db.getFirstSync<{ id: number }>('SELECT id FROM users WHERE email = ?', e)) {
    throw new Error('email_taken');
  }
  const res = db.runSync(
    'INSERT INTO users (email, password, created_at) VALUES (?, ?, ?)',
    e,
    password,
    new Date().toISOString()
  );
  const id = res.lastInsertRowId;
  // Seed this user's own copy of the preset categories.
  db.withTransactionSync(() => {
    PRESET_CATEGORIES.forEach((cat, index) => {
      db.runSync(
        'INSERT OR IGNORE INTO categories (user_id, name, emoji, type, is_preset, sort) VALUES (?, ?, ?, ?, 1, ?)',
        id,
        cat.name,
        cat.emoji,
        cat.type,
        index
      );
    });
  });
  return { id, email: e };
}

export function loginUser(email: string, password: string): AuthUser {
  const e = email.trim().toLowerCase();
  const row = db.getFirstSync<{ id: number; password: string }>(
    'SELECT id, password FROM users WHERE email = ?',
    e
  );
  if (!row || row.password !== password) throw new Error('invalid_credentials');
  return { id: row.id, email: e };
}

// --- Transactions -----------------------------------------------------------

export type TransactionInput = {
  type: EntryType;
  amount: number;
  category: string;
  note?: string;
  day?: string; // defaults to today
};

export function addTransaction(input: TransactionInput): number {
  const result = db.runSync(
    'INSERT INTO transactions (type, amount, category, note, day, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    input.type,
    input.amount,
    input.category,
    input.note ?? '',
    input.day ?? todayKey(),
    new Date().toISOString(),
    uid()
  );
  return result.lastInsertRowId;
}

export function updateTransaction(id: number, input: TransactionInput): void {
  db.runSync(
    'UPDATE transactions SET type = ?, amount = ?, category = ?, note = ?, day = ? WHERE id = ? AND user_id = ?',
    input.type,
    input.amount,
    input.category,
    input.note ?? '',
    input.day ?? todayKey(),
    id,
    uid()
  );
}

export function deleteTransaction(id: number): void {
  db.runSync('DELETE FROM transactions WHERE id = ? AND user_id = ?', id, uid());
}

export function getTransaction(id: number): Transaction | null {
  return db.getFirstSync<Transaction>(
    'SELECT * FROM transactions WHERE id = ? AND user_id = ?',
    id,
    currentUserId
  );
}

/** Entries for a single day, newest first. */
export function getTransactionsByDay(day: string): Transaction[] {
  return db.getAllSync<Transaction>(
    'SELECT * FROM transactions WHERE day = ? AND user_id = ? ORDER BY created_at DESC',
    day,
    currentUserId
  );
}

/** Every entry, newest day first (for the History screen). */
export function getAllTransactions(): Transaction[] {
  return db.getAllSync<Transaction>(
    'SELECT * FROM transactions WHERE user_id = ? ORDER BY day DESC, created_at DESC',
    currentUserId
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
     WHERE day BETWEEN ? AND ? AND user_id = ?`,
    startDay,
    endDay,
    currentUserId
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
     WHERE type = ? AND day BETWEEN ? AND ? AND user_id = ?
     GROUP BY category
     ORDER BY total DESC`,
    type,
    startDay,
    endDay,
    currentUserId
  );
}

/** Per-day in/out within a range, with empty days filled as zero. */
export function getDailyTotals(startDay: string, endDay: string): DayTotal[] {
  const rows = db.getAllSync<{ day: string; income: number; expense: number }>(
    `SELECT day,
       COALESCE(SUM(CASE WHEN type = 'in'  THEN amount END), 0) AS income,
       COALESCE(SUM(CASE WHEN type = 'out' THEN amount END), 0) AS expense
     FROM transactions
     WHERE day BETWEEN ? AND ? AND user_id = ?
     GROUP BY day`,
    startDay,
    endDay,
    currentUserId
  );
  return rows;
}

// --- Categories -------------------------------------------------------------

export function getCategories(type?: EntryType): Category[] {
  if (type) {
    return db.getAllSync<Category>(
      'SELECT * FROM categories WHERE type = ? AND user_id = ? ORDER BY sort ASC, name ASC',
      type,
      currentUserId
    );
  }
  return db.getAllSync<Category>(
    'SELECT * FROM categories WHERE user_id = ? ORDER BY sort ASC, name ASC',
    currentUserId
  );
}

/**
 * Add a custom category (or return the existing one with the same name+type).
 * Returns the category name so callers can select it immediately.
 */
export function addCategory(name: string, emoji: string, type: EntryType): string {
  const trimmed = name.trim();
  db.runSync(
    'INSERT OR IGNORE INTO categories (user_id, name, emoji, type, is_preset, sort) VALUES (?, ?, ?, ?, 0, 999)',
    uid(),
    trimmed,
    emoji,
    type
  );
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

export function addLoan(input: LoanInput): number {
  const result = db.runSync(
    'INSERT INTO loans (direction, person, amount, note, day, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    input.direction,
    input.person.trim(),
    input.amount,
    input.note ?? '',
    input.day ?? todayKey(),
    new Date().toISOString(),
    uid()
  );
  return result.lastInsertRowId;
}

export function updateLoan(id: number, input: LoanInput): void {
  db.runSync(
    'UPDATE loans SET direction = ?, person = ?, amount = ?, note = ?, day = ? WHERE id = ? AND user_id = ?',
    input.direction,
    input.person.trim(),
    input.amount,
    input.note ?? '',
    input.day ?? todayKey(),
    id,
    uid()
  );
}

/** Removes the loan and its repayment history. */
export function deleteLoan(id: number): void {
  const u = uid();
  db.runSync('DELETE FROM loan_payments WHERE loan_id = ? AND user_id = ?', id, u);
  db.runSync('DELETE FROM loans WHERE id = ? AND user_id = ?', id, u);
}

export function getLoan(id: number): Loan | null {
  return db.getFirstSync<Loan>(
    `SELECT l.*, COALESCE(SUM(p.amount), 0) AS repaid
     FROM loans l
     LEFT JOIN loan_payments p ON p.loan_id = l.id
     WHERE l.id = ? AND l.user_id = ?
     GROUP BY l.id`,
    id,
    currentUserId
  );
}

/** All loans with their repaid totals: open first, then newest first. */
export function getLoans(): Loan[] {
  return db.getAllSync<Loan>(
    `SELECT l.*, COALESCE(SUM(p.amount), 0) AS repaid
     FROM loans l
     LEFT JOIN loan_payments p ON p.loan_id = l.id
     WHERE l.user_id = ?
     GROUP BY l.id
     ORDER BY (COALESCE(SUM(p.amount), 0) >= l.amount) ASC, l.day DESC, l.created_at DESC`,
    currentUserId
  );
}

export function addLoanPayment(loanId: number, amount: number, day?: string): number {
  const result = db.runSync(
    'INSERT INTO loan_payments (loan_id, amount, day, created_at, user_id) VALUES (?, ?, ?, ?, ?)',
    loanId,
    amount,
    day ?? todayKey(),
    new Date().toISOString(),
    uid()
  );
  return result.lastInsertRowId;
}

export function deleteLoanPayment(id: number): void {
  db.runSync('DELETE FROM loan_payments WHERE id = ? AND user_id = ?', id, uid());
}

/** Repayments for one loan, newest first. */
export function getLoanPayments(loanId: number): LoanPayment[] {
  return db.getAllSync<LoanPayment>(
    'SELECT * FROM loan_payments WHERE loan_id = ? AND user_id = ? ORDER BY day DESC, created_at DESC',
    loanId,
    currentUserId
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
       WHERE l.user_id = ?
     )`,
    currentUserId
  );
  return { owedToMe: row?.owedToMe ?? 0, iOwe: row?.iOwe ?? 0 };
}

// --- Budgets ----------------------------------------------------------------
// Budgets are monthly limits on spending ('out' entries only). One row per
// category, plus an optional overall row (category = OVERALL_BUDGET).

/** Set a monthly limit; zero or less removes it. */
export function setBudget(category: string, amount: number): void {
  if (amount <= 0) {
    db.runSync('DELETE FROM budgets WHERE category = ? AND user_id = ?', category, uid());
    return;
  }
  db.runSync(
    `INSERT INTO budgets (user_id, category, amount) VALUES (?, ?, ?)
     ON CONFLICT (user_id, category) DO UPDATE SET amount = excluded.amount`,
    uid(),
    category,
    amount
  );
}

/** All budgets: overall first, then categories alphabetically. */
export function getBudgets(): Budget[] {
  return db.getAllSync<Budget>(
    "SELECT * FROM budgets WHERE user_id = ? ORDER BY (category = '') DESC, category ASC",
    currentUserId
  );
}

/** Each budget with its spend in the given range (usually one month). */
export function getBudgetProgress(startDay: string, endDay: string): BudgetProgress[] {
  return db.getAllSync<BudgetProgress>(
    `SELECT b.category, b.amount AS budget,
       COALESCE((
         SELECT SUM(t.amount) FROM transactions t
         WHERE t.type = 'out' AND t.day BETWEEN ? AND ?
           AND t.user_id = b.user_id
           AND (b.category = '' OR t.category = b.category)
       ), 0) AS spent
     FROM budgets b
     WHERE b.user_id = ?
     ORDER BY (b.category = '') DESC, b.category ASC`,
    startDay,
    endDay,
    currentUserId
  );
}

/** Danger zone: wipe the signed-in user's entries (categories are kept). */
export function clearAllTransactions(): void {
  db.runSync('DELETE FROM transactions WHERE user_id = ?', uid());
}

// Ensure the schema exists before any query runs (idempotent). A failure here
// is recorded and surfaced by the UI rather than crashing the whole app.
try {
  migrate();
} catch (e) {
  initError = `migrate: ${e instanceof Error ? e.message : String(e)}`;
}

// --- Cloud sync (embedded replica) ------------------------------------------
// One shared Turso database, replicated to every device. On a real build the
// app swaps `db` to the replica; every screen keeps using the same synchronous
// API, and per-user separation is handled by the user_id scoping above.

let replicaActive = false;
const dbChangeListeners = new Set<() => void>();

/** Subscribe to "the data changed or the connection was swapped". */
export function onDbChanged(listener: () => void): () => void {
  dbChangeListeners.add(listener);
  return () => {
    dbChangeListeners.delete(listener);
  };
}

function notifyDbChanged(): void {
  dbChangeListeners.forEach((listener) => listener());
}

/** True while the active connection is a syncing cloud replica. */
export function isCloudActive(): boolean {
  return replicaActive;
}

/**
 * Point the app at the shared Turso database (an embedded replica) and pull it
 * down. Idempotent. Throws on builds without the expo-sqlite `useLibSQL` flag;
 * callers treat that as "sync unavailable on this build" and stay local.
 */
export async function activateCloudDatabase(url: string, token: string): Promise<boolean> {
  if (replicaActive) return true;

  const libSQLOptions = { url, authToken: token, remoteOnly: false };
  let cloud: SQLite.SQLiteDatabase;
  try {
    cloud = SQLite.openDatabaseSync(DATA_CLOUD_DB, { enableChangeListener: true, libSQLOptions });
  } catch {
    try {
      // Retry without the change listener, in case libSQL rejects it.
      cloud = SQLite.openDatabaseSync(DATA_CLOUD_DB, { libSQLOptions });
    } catch (e) {
      // No useLibSQL in this build, or a bad URL/token — stay on the local db.
      initError = `open replica: ${e instanceof Error ? e.message : String(e)}`;
      return false;
    }
  }

  db = cloud;
  replicaActive = true;

  // Create the schema locally right away so the app is usable immediately.
  try {
    migrate();
  } catch (e) {
    initError = `cloud migrate: ${e instanceof Error ? e.message : String(e)}`;
  }
  notifyDbChanged();

  // Sync with Turso in the BACKGROUND — never block startup on the network, or
  // a slow/hung first sync would leave the app stuck on the splash screen.
  cloud
    .syncLibSQL()
    .then(() => notifyDbChanged())
    .catch(() => {});
  return true;
}

/** Sync the replica with Turso. No-op (returns false) when not on the replica. */
export async function syncCloudNow(): Promise<boolean> {
  if (!replicaActive) return false;
  try {
    await db.syncLibSQL();
    notifyDbChanged();
    return true;
  } catch {
    return false; // offline; try again later
  }
}
