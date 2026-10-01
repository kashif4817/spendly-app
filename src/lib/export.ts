/**
 * Export the user's data as a CSV or PDF and hand it to the OS share sheet
 * (save to Files, email, WhatsApp, etc.). Handy for records and tax time.
 *
 * The user picks which parts go in (see ExportSheet) and for which period.
 * Everything is ticked by default, so one tap still exports it all.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { CURRENCY } from '@/constants/app';
import {
  getAllLedgerEntries,
  getBookMembers,
  getBudgets,
  getCategoryBreakdown,
  getCurrentUserId,
  getMonthlyTotals,
  getReportStats,
  getSharedBooks,
  getSharedEntries,
  getSharedMemberName,
  getTopTransactions,
  getTransactionsInRange,
  OVERALL_BUDGET,
  type Budget,
  type CategorySlice,
  type LedgerEntry,
  type MonthTotal,
  type ReportStats,
  type Transaction,
} from '@/db';
import {
  addMonths,
  formatFullDate,
  formatMonth,
  monthEnd,
  monthKeyLabel,
  monthStart,
  todayKey,
  yearEnd,
  yearStart,
} from '@/lib/date';
import { formatMoney } from '@/lib/money';

export type ExportFormat = 'csv' | 'pdf';
export type ExportResult = 'ok' | 'empty' | 'unavailable';

/** Balances this small are rounding noise, not money owed. */
const SETTLED_EPSILON = 0.005;

// --- What and when -----------------------------------------------------------

export type ExportSection = 'transactions' | 'people' | 'shared' | 'budgets';

/**
 * The parts of the app that can go into an export, in the order they appear
 * in the file. Old one-off loans were folded into the people ledger long ago
 * (see migrateLoansToLedger), so "Loans" here is that ledger — exporting the
 * legacy loans table as well would count the same money twice.
 */
export const EXPORT_SECTIONS: { key: ExportSection; label: string; hint: string }[] = [
  { key: 'transactions', label: 'Expenses & income', hint: 'Everything on the Expenses tab' },
  { key: 'people', label: 'Loans', hint: 'Who you gave to or took from, with balances' },
  { key: 'shared', label: 'Shared books', hint: 'Books you keep with another person' },
  { key: 'budgets', label: 'Budgets', hint: 'Your monthly limits' },
];

export type ExportPeriod = 'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear';

export const EXPORT_PERIODS: { key: ExportPeriod; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'thisYear', label: 'This year' },
  { key: 'lastYear', label: 'Last year' },
];

type DayRange = { start: string; end: string; label: string };

function periodRange(period: ExportPeriod): DayRange {
  const today = todayKey();
  switch (period) {
    case 'thisMonth':
      return { start: monthStart(today), end: monthEnd(today), label: formatMonth(today) };
    case 'lastMonth': {
      const key = addMonths(monthStart(today), -1);
      return { start: monthStart(key), end: monthEnd(key), label: formatMonth(key) };
    }
    case 'thisYear':
      return { start: yearStart(today), end: yearEnd(today), label: today.slice(0, 4) };
    case 'lastYear': {
      const key = addMonths(yearStart(today), -12);
      return { start: yearStart(key), end: yearEnd(key), label: key.slice(0, 4) };
    }
    default:
      return { start: '0000-01-01', end: '9999-12-31', label: 'All time' };
  }
}

// --- Gathering the rows ------------------------------------------------------

/** One person's standing: what moved in the period, and where it left them. */
type PersonRow = { person: string; gave: number; took: number; balance: number };

type BookEntryRow = { day: string; youPaid: boolean; payer: string; amount: number; note: string };

type BookRow = {
  name: string;
  /** The other member's label ("They" until their name is known). */
  them: string;
  balance: number;
  entries: BookEntryRow[];
};

type ExportData = {
  range: DayRange;
  transactions: Transaction[];
  /** Ledger entries in the period, newest first. */
  ledger: LedgerEntry[];
  people: PersonRow[];
  books: BookRow[];
  budgets: Budget[];
};

/**
 * Everything an export could contain for one period.
 *
 * Balances are worked out as of the period's END, from every entry up to then,
 * not just the ones inside it — "Ali owes you Rs 500 at the end of June" is the
 * useful figure, and a sum of June alone would say something else entirely.
 * For that reason someone with no entries in the period still shows up if they
 * carried a balance through it.
 */
function collectExport(period: ExportPeriod): ExportData {
  const range = periodRange(period);
  const inRange = (day: string) => day >= range.start && day <= range.end;

  const allLedger = getAllLedgerEntries();
  const byPerson = new Map<string, PersonRow>();
  const activeInRange = new Set<string>();
  for (const e of allLedger) {
    if (e.day > range.end) continue;
    let row = byPerson.get(e.person);
    if (!row) {
      row = { person: e.person, gave: 0, took: 0, balance: 0 };
      byPerson.set(e.person, row);
    }
    row.balance += e.direction === 'gave' ? e.amount : -e.amount;
    if (e.day >= range.start) {
      activeInRange.add(e.person);
      if (e.direction === 'gave') row.gave += e.amount;
      else row.took += e.amount;
    }
  }
  const people = Array.from(byPerson.values())
    .filter((p) => activeInRange.has(p.person) || Math.abs(p.balance) >= SETTLED_EPSILON)
    .sort((a, b) => a.person.localeCompare(b.person));

  const me = getCurrentUserId() ?? '';
  const books: BookRow[] = [];
  for (const book of getSharedBooks()) {
    const other = getBookMembers(book.id).find((m) => m.user_id !== me);
    const otherName = other ? getSharedMemberName(other.user_id) : null;
    const them = otherName ?? 'They';
    let balance = 0;
    const entries: BookEntryRow[] = [];
    for (const e of getSharedEntries(book.id)) {
      if (e.day > range.end) continue;
      const youPaid = e.payer_id === me;
      balance += youPaid ? e.amount : -e.amount;
      if (e.day >= range.start) {
        entries.push({ day: e.day, youPaid, payer: youPaid ? 'You' : them, amount: e.amount, note: e.note });
      }
    }
    if (entries.length > 0 || Math.abs(balance) >= SETTLED_EPSILON) {
      books.push({ name: book.name?.trim() || otherName || 'Shared book', them, balance, entries });
    }
  }

  return {
    range,
    transactions: getTransactionsInRange(range.start, range.end),
    ledger: allLedger.filter((e) => inRange(e.day)).reverse(),
    people,
    books,
    budgets: getBudgets(),
  };
}

/** How many rows each part holds for a period — shown next to each checkbox. */
export function exportCounts(period: ExportPeriod): Record<ExportSection, number> {
  const data = collectExport(period);
  return {
    transactions: data.transactions.length,
    people: data.ledger.length,
    shared: data.books.reduce((n, b) => n + b.entries.length, 0),
    budgets: data.budgets.length,
  };
}

/** True when a part would come out with nothing in it at all. */
function isSectionEmpty(data: ExportData, section: ExportSection): boolean {
  switch (section) {
    case 'transactions':
      return data.transactions.length === 0;
    case 'people':
      return data.people.length === 0;
    case 'shared':
      return data.books.length === 0;
    case 'budgets':
      return data.budgets.length === 0;
  }
}

// --- Shared wording ----------------------------------------------------------

function summarize(rows: Transaction[]) {
  let income = 0;
  let expense = 0;
  for (const t of rows) {
    if (t.type === 'in') income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, net: income - expense, count: rows.length };
}

/** "Owes you" / "You owe" / "Settled" for a balance (>0 = they owe you). */
function standing(balance: number): string {
  if (Math.abs(balance) < SETTLED_EPSILON) return 'Settled';
  return balance > 0 ? 'Owes you' : 'You owe';
}

/** Heading for a balance column: now, or at the end of a past period. */
function balanceHeading(range: DayRange): string {
  return range.end >= todayKey() ? 'Balance now' : `Balance on ${formatFullDate(range.end)}`;
}

const budgetLabel = (b: Budget) => (b.category === OVERALL_BUDGET ? 'All spending' : b.category);

const ledgerLabel = (e: LedgerEntry) => (e.direction === 'gave' ? 'You gave' : 'You took');

function receivablePayable(balances: number[]) {
  let receivable = 0;
  let payable = 0;
  for (const b of balances) {
    if (b > 0) receivable += b;
    else payable -= b;
  }
  return { receivable, payable };
}

async function share(uri: string, format: ExportFormat): Promise<ExportResult> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(
    uri,
    format === 'csv'
      ? { mimeType: 'text/csv', dialogTitle: 'Export (CSV)', UTI: 'public.comma-separated-values-text' }
      : { mimeType: 'application/pdf', dialogTitle: 'Export (PDF)', UTI: 'com.adobe.pdf' }
  );
  return 'ok';
}

// --- CSV ---------------------------------------------------------------------
// One file, one block per part. The share sheet takes a single file, and each
// part has its own columns, so every block carries its own header row. Excel
// and Google Sheets open it as one sheet with the blocks one under another.

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const csvRow = (cells: (string | number)[]) => cells.map(csvCell).join(',');

function csvBlock(title: string, header: string[], rows: (string | number)[][]): string[] {
  return [
    csvCell(title),
    csvRow(header),
    ...(rows.length ? rows.map(csvRow) : [csvCell('Nothing in this period')]),
    '',
  ];
}

function buildCsv(data: ExportData, sections: ExportSection[]): string {
  const amount = `Amount (${CURRENCY.trim()})`;
  const lines: string[] = [
    csvCell('Spendly export'),
    csvRow(['Period', data.range.label]),
    csvRow(['Generated', todayKey()]),
    '',
  ];

  for (const section of sections) {
    if (section === 'transactions') {
      lines.push(
        ...csvBlock(
          'EXPENSES & INCOME',
          ['Date', 'Type', 'Category', 'Note', amount],
          data.transactions.map((t) => [
            t.day,
            t.type === 'in' ? 'Income' : 'Expense',
            t.category,
            t.note,
            t.amount,
          ])
        )
      );
    } else if (section === 'people') {
      lines.push(
        ...csvBlock(
          'LOANS - BALANCES',
          ['Person', 'You gave', 'You took', balanceHeading(data.range), 'Status'],
          data.people.map((p) => [p.person, p.gave, p.took, Math.abs(p.balance), standing(p.balance)])
        ),
        ...csvBlock(
          'LOANS - ENTRIES',
          ['Date', 'Person', 'Type', 'Note', amount],
          data.ledger.map((e) => [e.day, e.person, ledgerLabel(e), e.note, e.amount])
        )
      );
    } else if (section === 'shared') {
      lines.push(
        ...csvBlock(
          'SHARED BOOKS - BALANCES',
          ['Book', 'With', balanceHeading(data.range), 'Status'],
          data.books.map((b) => [b.name, b.them, Math.abs(b.balance), standing(b.balance)])
        ),
        ...csvBlock(
          'SHARED BOOKS - ENTRIES',
          ['Date', 'Book', 'Paid by', 'Note', amount],
          data.books.flatMap((b) => b.entries.map((e) => [e.day, b.name, e.payer, e.note, e.amount]))
        )
      );
    } else {
      lines.push(
        ...csvBlock(
          'BUDGETS',
          ['Category', `Monthly limit (${CURRENCY.trim()})`],
          data.budgets.map((b) => [budgetLabel(b), b.amount])
        )
      );
    }
  }

  // The BOM tells Excel the file is UTF-8, so names in Urdu or with accents
  // don't come out as mojibake.
  return `﻿${lines.join('\n')}`;
}

export async function exportCsv(
  sections: ExportSection[],
  period: ExportPeriod
): Promise<ExportResult> {
  const data = collectExport(period);
  if (sections.every((s) => isSectionEmpty(data, s))) return 'empty';

  const uri = `${FileSystem.cacheDirectory}spendly-${todayKey()}.csv`;
  await FileSystem.writeAsStringAsync(uri, buildCsv(data, sections), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return share(uri, 'csv');
}

// --- PDF ---------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

const EMPTY = '<p class="empty">Nothing in this period.</p>';

function kpiCard(label: string, value: string, color?: string): string {
  return `<div class="card"><div class="k">${label}</div><div class="v"${
    color ? ` style="color:${color}"` : ''
  }>${value}</div></div>`;
}

/** A balance cell: the amount, coloured by who owes whom, with the status under it. */
function balanceCell(balance: number): string {
  const tone = Math.abs(balance) < SETTLED_EPSILON ? '' : balance > 0 ? 'in' : 'out';
  return `<td class="amt ${tone}">${formatMoney(Math.abs(balance))}<div class="st">${standing(balance)}</div></td>`;
}

function transactionsHtml(rows: Transaction[]): string {
  const { income, expense, net } = summarize(rows);
  const body = rows
    .map(
      (t) => `<tr>
        <td>${t.day}</td>
        <td>${t.type === 'in' ? 'Income' : 'Expense'}</td>
        <td>${esc(t.category)}</td>
        <td>${esc(t.note)}</td>
        <td class="amt ${t.type}">${t.type === 'in' ? '+' : '−'}${formatMoney(t.amount)}</td>
      </tr>`
    )
    .join('');

  return `<h2>Expenses &amp; income</h2>
    <div class="cards">
      ${kpiCard('Income', formatMoney(income), '#1a9c5b')}
      ${kpiCard('Expense', formatMoney(expense), '#e5484d')}
      ${kpiCard('Net', formatMoney(net))}
    </div>
    ${
      rows.length
        ? `<table>
            <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Note</th><th class="amt">Amount</th></tr></thead>
            <tbody>${body}</tbody>
          </table>`
        : EMPTY
    }`;
}

function peopleHtml(data: ExportData): string {
  const { receivable, payable } = receivablePayable(data.people.map((p) => p.balance));
  const balances = data.people
    .map(
      (p) => `<tr>
        <td>${esc(p.person)}</td>
        <td class="amt">${formatMoney(p.gave)}</td>
        <td class="amt">${formatMoney(p.took)}</td>
        ${balanceCell(p.balance)}
      </tr>`
    )
    .join('');
  const entries = data.ledger
    .map((e) => {
      const gave = e.direction === 'gave';
      return `<tr>
        <td>${e.day}</td>
        <td>${esc(e.person)}</td>
        <td>${ledgerLabel(e)}</td>
        <td>${esc(e.note)}</td>
        <td class="amt ${gave ? 'in' : 'out'}">${formatMoney(e.amount)}</td>
      </tr>`;
    })
    .join('');

  return `<h2>Loans</h2>
    <div class="cards">
      ${kpiCard('They owe you', formatMoney(receivable), '#1a9c5b')}
      ${kpiCard('You owe', formatMoney(payable), '#e5484d')}
    </div>
    ${
      data.people.length
        ? `<h3>Balances</h3><table>
            <thead><tr><th>Person</th><th class="amt">You gave</th><th class="amt">You took</th><th class="amt">${esc(
              balanceHeading(data.range)
            )}</th></tr></thead>
            <tbody>${balances}</tbody>
          </table>`
        : ''
    }
    ${
      data.ledger.length
        ? `<h3>Entries</h3><table>
            <thead><tr><th>Date</th><th>Person</th><th>Type</th><th>Note</th><th class="amt">Amount</th></tr></thead>
            <tbody>${entries}</tbody>
          </table>`
        : EMPTY
    }`;
}

function sharedHtml(data: ExportData): string {
  if (!data.books.length) return `<h2>Shared books</h2>${EMPTY}`;

  const books = data.books
    .map((b) => {
      const rows = b.entries
        .map(
          (e) => `<tr>
            <td>${e.day}</td>
            <td>${esc(e.payer)} paid</td>
            <td>${esc(e.note)}</td>
            <td class="amt ${e.youPaid ? 'in' : 'out'}">${formatMoney(e.amount)}</td>
          </tr>`
        )
        .join('');
      const settled = Math.abs(b.balance) < SETTLED_EPSILON;
      const summary = settled
        ? 'All settled'
        : b.balance > 0
          ? `${esc(b.them)} owes you ${formatMoney(b.balance)}`
          : `You owe ${esc(b.them)} ${formatMoney(-b.balance)}`;
      return `<h3>${esc(b.name)}</h3>
        <div class="sub">${summary}</div>
        ${
          rows
            ? `<table>
                <thead><tr><th>Date</th><th>Who paid</th><th>Note</th><th class="amt">Amount</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>`
            : EMPTY
        }`;
    })
    .join('');

  return `<h2>Shared books</h2>${books}`;
}

function budgetsHtml(budgets: Budget[]): string {
  const rows = budgets
    .map((b) => `<tr><td>${esc(budgetLabel(b))}</td><td class="amt">${formatMoney(b.amount)}</td></tr>`)
    .join('');
  return `<h2>Budgets</h2>
    ${
      budgets.length
        ? `<table>
            <thead><tr><th>Category</th><th class="amt">Monthly limit</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`
        : '<p class="empty">No budgets set.</p>'
    }`;
}

function buildHtml(data: ExportData, sections: ExportSection[]): string {
  const parts = sections.map((section) => {
    if (section === 'transactions') return transactionsHtml(data.transactions);
    if (section === 'people') return peopleHtml(data);
    if (section === 'shared') return sharedHtml(data);
    return budgetsHtml(data.budgets);
  });

  return `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    * { font-family: -apple-system, Roboto, Helvetica, sans-serif; }
    body { color: #14181c; padding: 24px; }
    h1 { font-size: 22px; margin: 0 0 2px; }
    h2 { font-size: 17px; margin: 28px 0 10px; padding-top: 14px; border-top: 2px solid #e0e1e6; }
    h3 { font-size: 14px; margin: 18px 0 6px; }
    h2, h3 { break-after: avoid; page-break-after: avoid; }
    .sub { color: #60646c; font-size: 12px; margin-bottom: 10px; }
    .cards { display: flex; gap: 10px; margin-bottom: 14px; }
    .card { flex: 1; border: 1px solid #e0e1e6; border-radius: 10px; padding: 10px 12px; }
    .card .k { color: #60646c; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
    .card .v { font-size: 18px; font-weight: 700; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th { text-align: left; color: #60646c; border-bottom: 2px solid #e0e1e6; padding: 8px 6px; }
    td { padding: 7px 6px; border-bottom: 1px solid #f0f0f3; vertical-align: top; }
    .amt { text-align: right; white-space: nowrap; font-weight: 600; }
    .in { color: #1a9c5b; } .out { color: #e5484d; }
    .st { color: #60646c; font-size: 10px; font-weight: 500; }
    .empty { color: #60646c; font-size: 12px; }
  </style></head><body>
    <h1>Spendly — Statement</h1>
    <div class="sub">${esc(data.range.label)} · Generated ${todayKey()}</div>
    ${parts.join('')}
  </body></html>`;
}

export async function exportPdf(
  sections: ExportSection[],
  period: ExportPeriod
): Promise<ExportResult> {
  const data = collectExport(period);
  if (sections.every((s) => isSectionEmpty(data, s))) return 'empty';

  const { uri } = await Print.printToFileAsync({ html: buildHtml(data, sections) });
  return share(uri, 'pdf');
}

// --- Advanced report PDF -----------------------------------------------------

function buildReportHtml(
  label: string,
  stats: ReportStats,
  months: MonthTotal[],
  cats: CategorySlice[],
  top: Transaction[]
): string {
  const savings = stats.income > 0 ? Math.round((stats.net / stats.income) * 100) : null;

  const monthsBlock =
    months.length > 1
      ? `<h2>By month</h2><table>
          <thead><tr><th>Month</th><th class="amt">In</th><th class="amt">Out</th><th class="amt">Net</th></tr></thead>
          <tbody>${months
            .map(
              (m) => `<tr><td>${monthKeyLabel(m.month)}</td>
                <td class="amt in">${formatMoney(m.income)}</td>
                <td class="amt out">${formatMoney(m.expense)}</td>
                <td class="amt">${formatMoney(m.income - m.expense)}</td></tr>`
            )
            .join('')}</tbody></table>`
      : '';

  const catBlock = cats.length
    ? `<h2>Where it went</h2><table>
        <thead><tr><th>Category</th><th class="amt">Spent</th><th class="amt">Share</th><th class="amt">Count</th></tr></thead>
        <tbody>${cats
          .map((c) => {
            const pct = stats.expense > 0 ? Math.round((c.total / stats.expense) * 100) : 0;
            return `<tr><td>${esc(c.category)}</td>
              <td class="amt out">${formatMoney(c.total)}</td>
              <td class="amt">${pct}%</td>
              <td class="amt">${c.count}</td></tr>`;
          })
          .join('')}</tbody></table>`
    : '';

  const topBlock = top.length
    ? `<h2>Biggest expenses</h2><table>
        <thead><tr><th>Date</th><th>Category</th><th>Note</th><th class="amt">Amount</th></tr></thead>
        <tbody>${top
          .map(
            (t) => `<tr><td>${t.day}</td><td>${esc(t.category)}</td><td>${esc(t.note)}</td>
              <td class="amt out">${formatMoney(t.amount)}</td></tr>`
          )
          .join('')}</tbody></table>`
    : '';

  return `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    * { font-family: -apple-system, Roboto, Helvetica, sans-serif; }
    body { color: #14181c; padding: 24px; }
    h1 { font-size: 22px; margin: 0 0 2px; }
    h2 { font-size: 15px; margin: 22px 0 8px; }
    .sub { color: #60646c; font-size: 12px; margin-bottom: 16px; }
    .cards { display: flex; flex-wrap: wrap; gap: 10px; }
    .card { flex: 1 1 30%; border: 1px solid #e0e1e6; border-radius: 10px; padding: 10px 12px; }
    .card .k { color: #60646c; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
    .card .v { font-size: 18px; font-weight: 700; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; color: #60646c; border-bottom: 2px solid #e0e1e6; padding: 8px 6px; }
    td { padding: 7px 6px; border-bottom: 1px solid #f0f0f3; }
    .amt { text-align: right; white-space: nowrap; font-weight: 600; }
    .in { color: #1a9c5b; } .out { color: #e5484d; }
  </style></head><body>
    <h1>Spendly — ${esc(label)} report</h1>
    <div class="sub">Generated ${todayKey()} · ${stats.count} entr${stats.count === 1 ? 'y' : 'ies'}</div>
    <div class="cards">
      ${kpiCard('Income', formatMoney(stats.income), '#1a9c5b')}
      ${kpiCard('Expense', formatMoney(stats.expense), '#e5484d')}
      ${kpiCard('Net', formatMoney(stats.net))}
      ${kpiCard('Savings rate', savings === null ? '—' : `${savings}%`)}
      ${kpiCard('Avg / spend day', formatMoney(stats.avgPerDay))}
      ${kpiCard('Spending days', String(stats.spendDays))}
    </div>
    ${monthsBlock}
    ${catBlock}
    ${topBlock}
  </body></html>`;
}

/** Export the advanced report for a date range as a PDF. */
export async function exportReportPdf(
  startDay: string,
  endDay: string,
  label: string
): Promise<ExportResult> {
  const stats = getReportStats(startDay, endDay);
  if (stats.count === 0) return 'empty';

  const months = getMonthlyTotals(startDay, endDay);
  const cats = getCategoryBreakdown(startDay, endDay, 'out');
  const top = getTopTransactions(startDay, endDay, 'out', 8);

  const { uri } = await Print.printToFileAsync({
    html: buildReportHtml(label, stats, months, cats, top),
  });

  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Export report (PDF)',
    UTI: 'com.adobe.pdf',
  });
  return 'ok';
}
