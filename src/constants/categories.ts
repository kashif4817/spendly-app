import type MaterialIcons from '@expo/vector-icons/MaterialIcons';

import type { EntryType } from '@/db';

/**
 * Categories are drawn with icons, not emoji.
 *
 * Emoji are rendered by the operating system, so they ignored the app's
 * palette entirely, changed shape between phones, and sat at a different
 * weight to everything around them. These are MaterialIcons, which take a
 * colour and a size like any other glyph in the app.
 *
 * WHAT IS STORED: the database column is still called `emoji` and still holds
 * TEXT — renaming it would mean a schema migration and a round of sync churn
 * for no behavioural gain. It now holds an ICON NAME. Rows written by older
 * versions still hold a real emoji, which `iconFor()` maps across; see
 * LEGACY_EMOJI_ICONS below.
 */
export type CategoryIcon = React.ComponentProps<typeof MaterialIcons>['name'];

export type PresetCategory = {
  name: string;
  emoji: CategoryIcon;
  type: EntryType;
};

/**
 * Default categories seeded into the database on first launch. The user can add
 * their own on top of these from the Add-entry screen.
 */
export const PRESET_CATEGORIES: PresetCategory[] = [
  // Money out — everyday hostel/student spends first
  { name: 'Breakfast', emoji: 'bakery-dining', type: 'out' },
  { name: 'Lunch', emoji: 'lunch-dining', type: 'out' },
  { name: 'Dinner', emoji: 'dinner-dining', type: 'out' },
  { name: 'Tea', emoji: 'local-cafe', type: 'out' },
  { name: 'Coffee', emoji: 'coffee', type: 'out' },
  { name: 'Snacks', emoji: 'fastfood', type: 'out' },
  { name: 'Groceries', emoji: 'shopping-cart', type: 'out' },
  { name: 'Transport', emoji: 'directions-bus', type: 'out' },
  { name: 'Mobile / Recharge', emoji: 'smartphone', type: 'out' },
  { name: 'Rent', emoji: 'home', type: 'out' },
  { name: 'Laundry', emoji: 'local-laundry-service', type: 'out' },
  { name: 'Stationery', emoji: 'edit', type: 'out' },
  { name: 'Health', emoji: 'medical-services', type: 'out' },
  { name: 'Entertainment', emoji: 'movie', type: 'out' },
  { name: 'Other', emoji: 'category', type: 'out' },
  // Money in (income)
  { name: 'Pocket money', emoji: 'payments', type: 'in' },
  { name: 'Salary', emoji: 'work', type: 'in' },
  { name: 'Gift', emoji: 'card-giftcard', type: 'in' },
  { name: 'Other income', emoji: 'savings', type: 'in' },
];

/** Fallback icon when a category has none (e.g. a deleted custom one). */
export const FALLBACK_ICON: CategoryIcon = 'receipt-long';

/** Icons offered when choosing or changing a category's icon. */
export const CATEGORY_ICONS: CategoryIcon[] = [
  // Food & drink
  'restaurant', 'lunch-dining', 'dinner-dining', 'fastfood',
  'local-pizza', 'ramen-dining', 'bakery-dining', 'icecream',
  'local-cafe', 'coffee', 'local-bar', 'liquor',
  'shopping-cart', 'egg-alt',
  // Travel & transport
  'directions-bus', 'local-taxi', 'directions-car', 'two-wheeler',
  'pedal-bike', 'local-gas-station', 'flight', 'train',
  'luggage', 'beach-access', 'directions-walk', 'local-shipping',
  // Home & bills
  'home', 'apartment', 'bed', 'local-laundry-service',
  'lightbulb', 'water-drop', 'local-fire-department', 'wifi',
  'smartphone', 'laptop', 'tv', 'cleaning-services',
  // Shopping & personal
  'shopping-bag', 'checkroom', 'shopping-basket', 'content-cut',
  'card-giftcard', 'diamond', 'watch', 'storefront',
  // Health & study
  'medical-services', 'monitor-heart', 'local-hospital', 'menu-book',
  'edit', 'school', 'science', 'fitness-center',
  // Fun & misc
  'movie', 'sports-esports', 'music-note', 'sports-soccer',
  'park', 'pets', 'celebration', 'category',
  // Money in
  'payments', 'savings', 'work', 'account-balance',
  'trending-up', 'receipt-long', 'credit-card', 'attach-money',
];

/**
 * What a stored emoji becomes.
 *
 * Every category written before this change holds a real emoji, and those
 * rows are synced — they arrive from the server and from other devices too,
 * so this is not a one-off migration that can be run and forgotten. Anything
 * not listed falls back to `FALLBACK_ICON`.
 */
const LEGACY_EMOJI_ICONS: Record<string, CategoryIcon> = {
  // Presets
  '🍳': 'egg-alt', '🍛': 'lunch-dining', '🍽️': 'dinner-dining', '🫖': 'local-cafe',
  '☕': 'coffee', '🍟': 'fastfood', '🛒': 'shopping-cart', '🚌': 'directions-bus',
  '📱': 'smartphone', '🏠': 'home', '🧺': 'local-laundry-service', '✏️': 'edit',
  '💊': 'medical-services', '🎬': 'movie', '📦': 'category', '💵': 'payments',
  '💼': 'work', '🎁': 'card-giftcard', '💰': 'savings', '💸': 'receipt-long',
  // The rest of the old picker
  '🍔': 'lunch-dining', '🍕': 'local-pizza', '🍜': 'ramen-dining', '🥗': 'restaurant',
  '🍪': 'bakery-dining', '🥤': 'local-bar', '🍺': 'liquor', '🍎': 'restaurant',
  '🧁': 'icecream', '🚕': 'local-taxi', '🚗': 'directions-car', '🛺': 'local-taxi',
  '🛵': 'two-wheeler', '🚲': 'pedal-bike', '⛽': 'local-gas-station', '🛣️': 'directions-car',
  '✈️': 'flight', '🚄': 'train', '🧳': 'luggage', '🏖️': 'beach-access',
  '🏢': 'apartment', '🛏️': 'bed', '💡': 'lightbulb', '🚰': 'water-drop',
  '🔥': 'local-fire-department', '📶': 'wifi', '💻': 'laptop', '📺': 'tv',
  '🧹': 'cleaning-services', '🛍️': 'shopping-bag', '👕': 'checkroom', '👟': 'checkroom',
  '💄': 'shopping-basket', '💇': 'content-cut', '💍': 'diamond', '👓': 'watch',
  '🩺': 'monitor-heart', '🏥': 'local-hospital', '🦷': 'medical-services', '📚': 'menu-book',
  '🎓': 'school', '🔬': 'science', '🎮': 'sports-esports', '🎵': 'music-note',
  '⚽': 'sports-soccer', '🏋️': 'fitness-center', '🏕️': 'park', '🐾': 'pets',
  '🏦': 'account-balance', '📈': 'trending-up', '🧾': 'receipt-long', '💳': 'credit-card',
  '🤝': 'payments',
};

/**
 * Every icon name the app itself can store: the picker's list, the presets,
 * and the one a brand-new category starts with.
 *
 * `iconFor` checks against THIS rather than guessing from the shape of the
 * string. A guess would hand MaterialIcons any lowercase-hyphen value it
 * found, and an unknown name renders as a blank box rather than failing —
 * which is the kind of thing nobody notices until a user reports a missing
 * icon they cannot explain.
 */
const KNOWN_ICONS = new Set<string>([
  ...CATEGORY_ICONS,
  ...PRESET_CATEGORIES.map((c) => c.emoji),
  'label', // what a new category starts with, before the user picks
]);

/**
 * Turn whatever is stored into an icon name.
 *
 * An icon this app can store passes through, a legacy emoji is mapped, and
 * anything else — a stray value, a name from a future version — falls back
 * rather than rendering an empty square.
 */
export function iconFor(stored: string | null | undefined): CategoryIcon {
  if (!stored) return FALLBACK_ICON;
  const value = stored.trim();
  if (KNOWN_ICONS.has(value)) return value as CategoryIcon;
  return LEGACY_EMOJI_ICONS[value] ?? FALLBACK_ICON;
}
