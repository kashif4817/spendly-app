/**
 * What you had started typing in a book, kept until you send it.
 *
 * WHY: a chat draft is the one piece of text in the app with no save button.
 * Tapping an entry to check what something was, or answering a notification
 * from another book, unmounts the screen — and losing half a sentence to that
 * is the kind of small betrayal people stop trusting an app over.
 *
 * Device-local and per book, in AsyncStorage. There is deliberately no sync:
 * a draft is a thought in progress, not a fact about the book, and seeing an
 * unsent half-sentence appear on another device is worse than retyping it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'spendly.chatDrafts';

/** Long enough to be a message, short enough that storage can't run away. */
const MAX_LENGTH = 4000;

let drafts: Record<string, string> = {};
let loaded = false;
let pending: ReturnType<typeof setTimeout> | null = null;

async function hydrate(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    const parsed: unknown = JSON.parse(stored);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      drafts = parsed as Record<string, string>;
    }
  } catch {
    // Unreadable storage just means no drafts, which is a first run.
  }
}

/**
 * Write on a delay.
 *
 * Every keystroke changes the draft, and AsyncStorage is a round trip to
 * native on each call — so the last state of a burst of typing is what
 * actually lands, a moment after the typing stops.
 */
function persistSoon(): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(drafts)).catch(() => {
      // In memory for this session either way.
    });
  }, 600);
}

/** What was left unsent in this book, or ''. */
export async function loadChatDraft(bookId: string): Promise<string> {
  await hydrate();
  return drafts[bookId] ?? '';
}

/** Remember the current text. Pass '' once it has been sent or cleared. */
export function setChatDraft(bookId: string, text: string): void {
  if (!bookId) return;
  const trimmed = text.slice(0, MAX_LENGTH);
  if (trimmed) drafts[bookId] = trimmed;
  else delete drafts[bookId];
  persistSoon();
}
