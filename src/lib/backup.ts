import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import {
  getSpendlyBackupData,
  getCurrentUserId,
  restoreSpendlyBackupData,
  type BackupRestoreCounts,
  type SpendlyBackupData,
} from '@/db';

const BACKUP_FORMAT = 'spendly-backup';
const BACKUP_VERSION = 1;
const MAX_BACKUP_CHARS = 25_000_000;

export type SpendlyBackup = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  ownerId: string | null;
  data: SpendlyBackupData;
};

export type BackupSummary = {
  categories: number;
  transactions: number;
  budgets: number;
  ledgerEntries: number;
  people: number;
};

export type PickedBackup = {
  name: string;
  backup: SpendlyBackup;
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function string(value: unknown, max = 500): value is string {
  return typeof value === 'string' && value.length <= max;
}

function id(value: unknown): value is string {
  return string(value, 160) && value.length > 0;
}

function day(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function stamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && !Number.isNaN(Date.parse(value));
}

function positiveAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function array<T>(value: unknown, validate: (row: unknown) => row is T): value is T[] {
  return Array.isArray(value) && value.length <= 250_000 && value.every(validate);
}

function isCategory(row: unknown): row is SpendlyBackupData['categories'][number] {
  return object(row) && id(row.id) && string(row.name, 100) && row.name.length > 0 &&
    string(row.emoji, 32) && (row.type === 'in' || row.type === 'out') &&
    (row.is_preset === 0 || row.is_preset === 1) && Number.isInteger(row.sort);
}

function isTransaction(row: unknown): row is SpendlyBackupData['transactions'][number] {
  return object(row) && id(row.id) && (row.type === 'in' || row.type === 'out') &&
    positiveAmount(row.amount) && string(row.category, 100) && string(row.note, 4000) &&
    day(row.day) && stamp(row.created_at) &&
    (row.receipt_path === null || string(row.receipt_path, 1000));
}

function isBudget(row: unknown): row is SpendlyBackupData['budgets'][number] {
  return object(row) && id(row.id) && string(row.category, 100) &&
    typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount > 0;
}

function isLedgerEntry(row: unknown): row is SpendlyBackupData['ledgerEntries'][number] {
  return object(row) && id(row.id) && string(row.person, 100) && row.person.trim().length > 0 &&
    (row.direction === 'gave' || row.direction === 'took') && positiveAmount(row.amount) &&
    string(row.note, 4000) && day(row.day) && stamp(row.created_at);
}

function isPerson(row: unknown): row is SpendlyBackupData['people'][number] {
  return object(row) && string(row.person, 100) && row.person.trim().length > 0 &&
    typeof row.pinned === 'boolean' && typeof row.archived === 'boolean' &&
    !row.person.startsWith('#book:');
}

export function summarizeBackup(backup: SpendlyBackup): BackupSummary {
  return {
    categories: backup.data.categories.length,
    transactions: backup.data.transactions.length,
    budgets: backup.data.budgets.length,
    ledgerEntries: backup.data.ledgerEntries.length,
    people: new Set([
      ...backup.data.people.map((person) => person.person),
      ...backup.data.ledgerEntries.map((entry) => entry.person),
    ]).size,
  };
}

export async function exportBackup(): Promise<'ok' | 'unavailable'> {
  const backup: SpendlyBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    ownerId: getCurrentUserId(),
    data: getSpendlyBackupData(),
  };
  const uri = `${FileSystem.cacheDirectory}spendly-backup-${new Date().toISOString().slice(0, 10)}.json`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(backup, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(uri, {
    mimeType: 'application/json',
    dialogTitle: 'Save Spendly backup',
    UTI: 'public.json',
  });
  return 'ok';
}

export async function pickBackup(): Promise<PickedBackup | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'text/json', 'application/octet-stream'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) throw new Error('No file was selected.');
  if (asset.size && asset.size > MAX_BACKUP_CHARS) {
    throw new Error('This backup is too large to import.');
  }

  const text = asset.file ? await asset.file.text() : await FileSystem.readAsStringAsync(asset.uri);
  if (text.length > MAX_BACKUP_CHARS) throw new Error('This backup is too large to import.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file is not valid JSON. Choose a Spendly backup file.');
  }
  if (!object(parsed) || parsed.format !== BACKUP_FORMAT || parsed.version !== BACKUP_VERSION ||
      !stamp(parsed.createdAt) || !(parsed.ownerId === null || string(parsed.ownerId, 160)) ||
      !object(parsed.data)) {
    throw new Error('This is not a supported Spendly backup.');
  }

  const data = parsed.data;
  if (!array(data.categories, isCategory) || !array(data.transactions, isTransaction) ||
      !array(data.budgets, isBudget) || !array(data.ledgerEntries, isLedgerEntry) ||
      !array(data.people, isPerson)) {
    throw new Error('The backup is incomplete or contains invalid records. No data was changed.');
  }

  return {
    name: asset.name,
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: parsed.createdAt,
      ownerId: parsed.ownerId,
      data: data as unknown as SpendlyBackupData,
    },
  };
}

export function restoreBackup(backup: SpendlyBackup): BackupRestoreCounts {
  return restoreSpendlyBackupData(backup.data, {
    regenerateIds: backup.ownerId !== getCurrentUserId(),
  });
}
