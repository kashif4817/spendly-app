import * as SQLite from 'expo-sqlite';

import { PRESET_CATEGORIES } from '@/constants/categories';
import { todayKey } from '@/lib/date';

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

// Single shared connection for the whole app. `enableChangeListener` powers the
// live-refresh hook (see db/hooks.ts).
const db = SQLite.openDatabaseSync('expenses.db', { enableChangeListener: true });

const DATABASE_VERSION = 1;

/** Create tables and seed preset categories. Runs once per schema version. */
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

    PRESET_CATEGORIES.forEach((cat, index) => {
      db.runSync(
        'INSERT INTO categories (name, emoji, type, is_preset, sort) VALUES (?, ?, ?, 1, ?)',
        cat.name,
        cat.emoji,
        cat.type,
        index
      );
    });

    version = 1;
  }

  db.execSync(`PRAGMA user_version = ${DATABASE_VERSION}`);
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
    'INSERT INTO transactions (type, amount, category, note, day, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    input.type,
    input.amount,
    input.category,
    input.note ?? '',
    input.day ?? todayKey(),
    new Date().toISOString()
  );
  return result.lastInsertRowId;
}

export function updateTransaction(id: number, input: TransactionInput): void {
  db.runSync(
    'UPDATE transactions SET type = ?, amount = ?, category = ?, note = ?, day = ? WHERE id = ?',
    input.type,
    input.amount,
    input.category,
    input.note ?? '',
    input.day ?? todayKey(),
    id
  );
}

export function deleteTransaction(id: number): void {
  db.runSync('DELETE FROM transactions WHERE id = ?', id);
}

export function getTransaction(id: number): Transaction | null {
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

/**
 * Add a custom category (or return the existing one with the same name+type).
 * Returns the category name so callers can select it immediately.
 */
export function addCategory(name: string, emoji: string, type: EntryType): string {
  const trimmed = name.trim();
  db.runSync(
    'INSERT OR IGNORE INTO categories (name, emoji, type, is_preset, sort) VALUES (?, ?, ?, 0, 999)',
    trimmed,
    emoji,
    type
  );
  return trimmed;
}

/** Danger zone: wipe all entries (categories are kept). */
export function clearAllTransactions(): void {
  db.execSync('DELETE FROM transactions');
}

// Ensure the schema exists before any query runs (idempotent).
migrate();
