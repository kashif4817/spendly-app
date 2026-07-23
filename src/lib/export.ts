/**
 * Export the user's transactions as a CSV or PDF and hand them to the OS share
 * sheet (save to Files, email, WhatsApp, etc.). Handy for records and tax time.
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { CURRENCY } from '@/constants/app';
import {
  getAllTransactions,
  getCategoryBreakdown,
  getMonthlyTotals,
  getReportStats,
  getTopTransactions,
  type CategorySlice,
  type MonthTotal,
  type ReportStats,
  type Transaction,
} from '@/db';
import { monthKeyLabel, todayKey } from '@/lib/date';
import { formatMoney } from '@/lib/money';

function summarize(rows: Transaction[]) {
  let income = 0;
  let expense = 0;
  for (const t of rows) {
    if (t.type === 'in') income += t.amount;
    else expense += t.amount;
  }
  return { income, expense, net: income - expense, count: rows.length };
}

// --- CSV ---------------------------------------------------------------------

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function buildCsv(rows: Transaction[]): string {
  const header = ['Date', 'Type', 'Category', 'Note', `Amount (${CURRENCY.trim()})`];
  const lines = rows.map((t) =>
    [t.day, t.type === 'in' ? 'Income' : 'Expense', t.category, t.note, t.amount].map(csvCell).join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

export async function exportCsv(): Promise<'ok' | 'empty' | 'unavailable'> {
  const rows = getAllTransactions();
  if (rows.length === 0) return 'empty';

  const uri = `${FileSystem.cacheDirectory}spendly-${todayKey()}.csv`;
  await FileSystem.writeAsStringAsync(uri, buildCsv(rows), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(uri, {
    mimeType: 'text/csv',
    dialogTitle: 'Export transactions (CSV)',
    UTI: 'public.comma-separated-values-text',
  });
  return 'ok';
}

// --- PDF ---------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

function buildHtml(rows: Transaction[]): string {
  const { income, expense, net, count } = summarize(rows);
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

  return `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    * { font-family: -apple-system, Roboto, Helvetica, sans-serif; }
    body { color: #14181c; padding: 24px; }
    h1 { font-size: 22px; margin: 0 0 2px; }
    .sub { color: #60646c; font-size: 12px; margin-bottom: 16px; }
    .cards { display: flex; gap: 10px; margin-bottom: 18px; }
    .card { flex: 1; border: 1px solid #e0e1e6; border-radius: 10px; padding: 10px 12px; }
    .card .k { color: #60646c; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
    .card .v { font-size: 18px; font-weight: 700; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; color: #60646c; border-bottom: 2px solid #e0e1e6; padding: 8px 6px; }
    td { padding: 7px 6px; border-bottom: 1px solid #f0f0f3; }
    .amt { text-align: right; white-space: nowrap; font-weight: 600; }
    .amt.in { color: #1a9c5b; } .amt.out { color: #e5484d; }
  </style></head><body>
    <h1>Spendly — Transactions</h1>
    <div class="sub">Exported ${todayKey()} · ${count} entr${count === 1 ? 'y' : 'ies'}</div>
    <div class="cards">
      <div class="card"><div class="k">Income</div><div class="v" style="color:#1a9c5b">${formatMoney(income)}</div></div>
      <div class="card"><div class="k">Expense</div><div class="v" style="color:#e5484d">${formatMoney(expense)}</div></div>
      <div class="card"><div class="k">Net</div><div class="v">${formatMoney(net)}</div></div>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Note</th><th class="amt">Amount</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </body></html>`;
}

export async function exportPdf(): Promise<'ok' | 'empty' | 'unavailable'> {
  const rows = getAllTransactions();
  if (rows.length === 0) return 'empty';

  const { uri } = await Print.printToFileAsync({ html: buildHtml(rows) });

  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Export transactions (PDF)',
    UTI: 'com.adobe.pdf',
  });
  return 'ok';
}

// --- Advanced report PDF -----------------------------------------------------

function kpiCard(label: string, value: string, color?: string): string {
  return `<div class="card"><div class="k">${label}</div><div class="v"${
    color ? ` style="color:${color}"` : ''
  }>${value}</div></div>`;
}

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
): Promise<'ok' | 'empty' | 'unavailable'> {
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
