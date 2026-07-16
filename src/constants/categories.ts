import type { EntryType } from '@/db';

export type PresetCategory = {
  name: string;
  emoji: string;
  type: EntryType;
};

/**
 * Default categories seeded into the database on first launch. The user can add
 * their own on top of these from the Add-entry screen.
 */
export const PRESET_CATEGORIES: PresetCategory[] = [
  // Money out (expenses)
  { name: 'Food', emoji: '🍔', type: 'out' },
  { name: 'Groceries', emoji: '🛒', type: 'out' },
  { name: 'Transport', emoji: '🚗', type: 'out' },
  { name: 'Bills', emoji: '💡', type: 'out' },
  { name: 'Rent', emoji: '🏠', type: 'out' },
  { name: 'Shopping', emoji: '🛍️', type: 'out' },
  { name: 'Health', emoji: '💊', type: 'out' },
  { name: 'Entertainment', emoji: '🎬', type: 'out' },
  { name: 'Other', emoji: '📦', type: 'out' },
  // Money in (income)
  { name: 'Salary', emoji: '💼', type: 'in' },
  { name: 'Business', emoji: '🏢', type: 'in' },
  { name: 'Gift', emoji: '🎁', type: 'in' },
  { name: 'Other income', emoji: '💰', type: 'in' },
];

/** Fallback emoji when a category has no icon (e.g. a deleted custom one). */
export const FALLBACK_EMOJI = '💸';
