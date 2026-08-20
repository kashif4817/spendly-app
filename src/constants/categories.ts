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
  // Money out — everyday hostel/student spends first
  { name: 'Breakfast', emoji: '🍳', type: 'out' },
  { name: 'Lunch', emoji: '🍛', type: 'out' },
  { name: 'Dinner', emoji: '🍽️', type: 'out' },
  { name: 'Tea', emoji: '🫖', type: 'out' },
  { name: 'Coffee', emoji: '☕', type: 'out' },
  { name: 'Snacks', emoji: '🍟', type: 'out' },
  { name: 'Groceries', emoji: '🛒', type: 'out' },
  { name: 'Transport', emoji: '🚌', type: 'out' },
  { name: 'Mobile / Recharge', emoji: '📱', type: 'out' },
  { name: 'Rent', emoji: '🏠', type: 'out' },
  { name: 'Laundry', emoji: '🧺', type: 'out' },
  { name: 'Stationery', emoji: '✏️', type: 'out' },
  { name: 'Health', emoji: '💊', type: 'out' },
  { name: 'Entertainment', emoji: '🎬', type: 'out' },
  { name: 'Other', emoji: '📦', type: 'out' },
  // Money in (income)
  { name: 'Pocket money', emoji: '💵', type: 'in' },
  { name: 'Salary', emoji: '💼', type: 'in' },
  { name: 'Gift', emoji: '🎁', type: 'in' },
  { name: 'Other income', emoji: '💰', type: 'in' },
];

/** Fallback emoji when a category has no icon (e.g. a deleted custom one). */
export const FALLBACK_EMOJI = '💸';

/** Emoji offered when choosing or changing a category's icon. */
export const CATEGORY_EMOJIS: string[] = [
  // Food & drink
  '🍳', '🍛', '🍽️', '🍔', '🍕', '🍜', '🥗', '🍪',
  '🍟', '☕', '🫖', '🥤', '🍺', '🛒', '🍎', '🧁',
  // Travel & transport
  '🚌', '🚕', '🚗', '🛺', '🛵', '🚲', '⛽', '🛣️',
  '✈️', '🚄', '🧳', '🏖️',
  // Home & bills
  '🏠', '🏢', '🛏️', '🧺', '💡', '🚰', '🔥', '📶',
  '📱', '💻', '📺', '🧹',
  // Shopping & personal
  '🛍️', '👕', '👟', '💄', '💇', '🎁', '💍', '👓',
  // Health & study
  '💊', '🩺', '🏥', '🦷', '📚', '✏️', '🎓', '🔬',
  // Fun & misc
  '🎬', '🎮', '🎵', '⚽', '🏋️', '🏕️', '🐾', '📦',
  // Money in
  '💵', '💰', '💼', '🏦', '📈', '🧾', '🤝', '💳',
];
