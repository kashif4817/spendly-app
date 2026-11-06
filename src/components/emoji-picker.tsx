/**
 * The emoji panel that opens where the keyboard was.
 *
 * NOT a modal. A sheet over the thread would cover the message you are
 * writing, which is the one thing you need to see while you decorate it — so
 * this takes the keyboard's place instead, the way every chat app does it, and
 * the composer stays put between the two. <ChatComposer> owns the swap; this
 * file is only the panel's insides.
 *
 * The list is curated rather than generated from a Unicode range: a range
 * includes glyphs no phone has, which render as the dreaded empty box, and
 * orders them by codepoint — so the faces people actually use end up scattered
 * through several screens of symbols.
 *
 * NOTHING NEWER THAN UNICODE 13.0 (2020) GOES IN THESE LISTS. An emoji font is
 * part of the system image, so it stops wherever the Android version a phone
 * shipped with stopped — and a glyph the font has never heard of does not fall
 * back to anything sensible. It draws as half a character or an empty box, in
 * the picker AND in every message it was ever put into. Unicode 13 is Android
 * 11, which is old enough that every phone running this app has it.
 *
 * So: 🫠 🫡 🫢 🫣 🫤 🫥 🫦 🥹, the 🫱🫲🫳🫴🫰🫵🫶 hands (all Unicode 14) and
 * 🩷 🩵 🩶 🟰 (Unicode 15) are deliberately absent, and must stay absent until
 * the floor moves. `SUPPORTED` below is what keeps an old saved favourite from
 * dragging one back in.
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Scrim, Spacing } from '@/constants/theme';
import { useRecentEmoji } from '@/hooks/use-recent-emoji';
import { useTheme } from '@/hooks/use-theme';
import { recordRecentEmoji } from '@/lib/recent-emoji';

/**
 * Drop the last visible character from a string — the panel's backspace.
 *
 * NOT `slice(0, -1)`. An emoji is rarely one code unit: a flag is two, a
 * thumbs-up with a skin tone is two plus a modifier, and a family is several
 * joined by zero-width joiners. Cutting one unit off the end of any of those
 * leaves the rest behind as a different glyph, or as a lone half of a
 * surrogate pair that renders as a box.
 *
 * So this walks back over the pieces that cannot stand alone — variation
 * selectors, skin tones, the keycap mark — then the character they belong to,
 * and keeps going while a joiner says the part before it is the same glyph.
 */
export function dropLastGrapheme(text: string): string {
  // Array.from splits on code points, so a surrogate pair is already one item.
  const chars = Array.from(text);
  if (chars.length === 0) return text;

  const binds = (char: string | undefined): boolean => {
    const code = char?.codePointAt(0) ?? -1;
    return (
      code === 0xfe0f || // emoji presentation
      code === 0xfe0e || // text presentation
      code === 0x20e3 || // the ring round a keycap
      (code >= 0x1f3fb && code <= 0x1f3ff) // skin tones
    );
  };

  let end = chars.length;
  while (end > 0 && binds(chars[end - 1])) end -= 1;
  if (end > 0) end -= 1;

  // A zero-width joiner means the part before it is the same glyph, so take
  // that one too — and whatever binds to it.
  while (end > 0 && chars[end - 1].codePointAt(0) === 0x200d) {
    end -= 1;
    while (end > 0 && binds(chars[end - 1])) end -= 1;
    if (end > 0) end -= 1;
  }

  return chars.slice(0, end).join('');
}

type GroupKey = 'recent' | 'smileys' | 'nature' | 'food' | 'activity' | 'travel' | 'objects' | 'symbols';

type EmojiGroup = {
  key: GroupKey;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  emoji: string[];
};

const SMILEYS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍',
  '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫',
  '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤',
  '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '🥸',
  '😎', '🤓', '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '😦', '😧', '😨',
  '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠',
  '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸',
  '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🙈', '🙉', '🙊', '👋', '🤚', '🖐', '✋', '🖖',
  '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎',
  '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '💪', '👀', '👁',
  '👅', '👄', '💋', '🧠', '👂', '👃', '👶', '🧒', '👦', '👧', '🧑', '👨', '👩', '🧔', '👴',
  '👵', '👮', '🕵', '💂', '👷', '🤴', '👸', '👰', '🤵', '🤰', '🤱', '🎅', '🦸', '🦹', '🧙',
  '🧚', '🧜', '🧝', '🧟', '💆', '💇', '🚶', '🧍', '🧎', '🏃', '💃', '🕺', '👯', '🧖', '👫',
  '👬', '👭', '💑', '👪', '🗣', '👤',
];

const NATURE = [
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸',
  '🐵', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴',
  '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷', '🕸',
  '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬',
  '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒',
  '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐈',
  '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🕊', '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦥', '🐁',
  '🐀', '🐿', '🦔', '🐾', '🐉', '🐲',
  '🌵', '🎄', '🌲', '🌳', '🌴', '🪵', '🌱', '🌿', '☘️', '🍀', '🎍', '🪴', '🎋', '🍃', '🍂',
  '🍁', '🍄', '🐚', '🪨', '🌾', '💐', '🌷', '🌹', '🥀', '🌺', '🌸', '🌼', '🌻', '🌞', '🌝',
  '🌛', '🌜', '🌚', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '🌙', '🌎', '🌍', '🌏',
  '🪐', '💫', '⭐️', '🌟', '✨', '⚡️', '☄️', '💥', '🔥', '🌪', '🌈', '☀️', '🌤', '⛅️', '🌥',
  '☁️', '🌦', '🌧', '⛈', '🌩', '🌨', '❄️', '☃️', '⛄️', '🌬', '💨', '💧', '💦', '☔️', '☂️',
  '🌊', '🌫',
];

const FOOD = [
  '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍',
  '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅',
  '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩',
  '🍗', '🍖', '🦴', '🌭', '🍔', '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗',
  '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘',
  '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬',
  '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '🫖', '☕️', '🍵', '🧃', '🥤', '🧋',
  '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊', '🥄', '🍴', '🍽', '🥣',
  '🥡', '🥢', '🧂',
];

const ACTIVITY = [
  '⚽️', '🏀', '🏈', '⚾️', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑',
  '🥍', '🏏', '🪃', '🥅', '⛳️', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷',
  '⛸', '🥌', '🎿', '⛷', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾', '🏌️', '🏇', '🧘',
  '🏄', '🏊', '🤽', '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖', '🏵', '🎗',
  '🎫', '🎟', '🎪', '🤹', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🪘', '🎷',
  '🎺', '🪗', '🎸', '🪕', '🎻', '🎲', '♟', '🎯', '🎳', '🎮', '🎰', '🧩', '🃏', '🀄️',
];

const TRAVEL = [
  '🚗', '🚕', '🚙', '🚌', '🚎', '🏎', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🦽',
  '🦼', '🛴', '🚲', '🛵', '🏍', '🛺', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃',
  '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩',
  '💺', '🛰', '🚀', '🛸', '🚁', '🛶', '⛵️', '🚤', '🛥', '🛳', '⛴', '🚢', '⚓️', '⛽️', '🚧',
  '🚦', '🚥', '🚏', '🗺', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟', '🎡', '🎢', '🎠', '⛲️', '⛱',
  '🏖', '🏝', '🏜', '🌋', '⛰', '🏔', '🗻', '🏕', '⛺️', '🛖', '🏠', '🏡', '🏘', '🏚', '🏗',
  '🏭', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', '🏛', '⛪️', '🕌',
  '🕍', '🛕', '🕋', '⛩', '🛤', '🛣', '🗾', '🎑', '🏞', '🌅', '🌄', '🌠', '🎇', '🎆', '🌇',
  '🌆', '🏙', '🌃', '🌌', '🌉', '🌁',
];

const OBJECTS = [
  '⌚️', '📱', '📲', '💻', '⌨️', '🖥', '🖨', '🖱', '🖲', '🕹', '💽', '💾', '💿', '📀', '📼',
  '📷', '📸', '📹', '🎥', '📽', '🎞', '📞', '☎️', '📟', '📠', '📺', '📻', '🎙', '🎚', '🎛',
  '🧭', '⏱', '⏲', '⏰', '🕰', '⌛️', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯', '🪔', '🧯',
  '🛢', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '💎', '⚖️', '🪜', '🧰', '🪛', '🔧',
  '🔨', '⚒', '🛠', '⛏', '🪚', '🔩', '⚙️', '🧱', '⛓', '🧲', '🔫', '💣', '🧨', '🪓', '🔪',
  '🗡', '⚔️', '🛡', '🚬', '⚰️', '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '💈', '⚗️', '🔭', '🔬',
  '🕳', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡', '🧹', '🪠', '🧺', '🧻',
  '🚽', '🚰', '🚿', '🛁', '🧼', '🪥', '🪒', '🧽', '🪣', '🧴', '🛎', '🔑', '🗝', '🚪', '🪑',
  '🛋', '🛏', '🛌', '🧸', '🪆', '🖼', '🪞', '🪟', '🛍', '🛒', '🎁', '🎈', '🎏', '🎀', '🪄',
  '🪅', '🎊', '🎉', '🎎', '🏮', '🎐', '🧧', '✉️', '📩', '📨', '📧', '💌', '📥', '📤', '📦',
  '🏷', '🪧', '📪', '📫', '📬', '📭', '📮', '📯', '📜', '📃', '📄', '📑', '🧾', '📊', '📈',
  '📉', '🗒', '🗓', '📆', '📅', '🗑', '📇', '🗃', '🗳', '🗄', '📋', '📁', '📂', '🗂', '🗞',
  '📰', '📓', '📔', '📒', '📕', '📗', '📘', '📙', '📚', '📖', '🔖', '🧷', '🔗', '📎', '🖇',
  '📐', '📏', '🧮', '📌', '📍', '✂️', '🖊', '🖋', '✒️', '🖌', '🖍', '📝', '✏️', '🔍', '🔎',
  '🔏', '🔐', '🔒', '🔓',
];

const SYMBOLS = [
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗',
  '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐',
  '⛎', '♈️', '♉️', '♊️', '♋️', '♌️', '♍️', '♎️', '♏️', '♐️', '♑️', '♒️', '♓️', '🆔', '⚛️',
  '☢️', '☣️', '📴', '📳', '🈶', '🈚️', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️',
  '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕️', '🛑', '⛔️', '📛',
  '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗️', '❕', '❓', '❔',
  '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯️', '💹', '❇️',
  '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿️', '🅿️', '🛗', '🈳', '🈂️', '🛂',
  '🛃', '🛄', '🛅', '🚹', '🚺', '🚼', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡',
  '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣',
  '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸', '⏯', '⏹', '⏺', '⏭', '⏮', '⏩',
  '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️',
  '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗',
  '✖️', '♾️', '💲', '💱', '™️', '©️', '®️', '🔚', '🔙', '🔛', '🔝', '🔜', '〰️', '➰', '➿',
  '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫️', '⚪️', '🟤', '🔺', '🔻', '🔸',
  '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '⬛️', '⬜️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪',
  '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '💬', '💭', '🗯', '♠️', '♣️', '♥️',
  '♦️', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛',
];

/**
 * The tabs, in the order they are shown. Recent is first and comes from the
 * store rather than from here, so it is the only one that can be empty.
 */
const GROUPS: EmojiGroup[] = [
  { key: 'recent', icon: 'schedule', label: 'Recently used', emoji: [] },
  { key: 'smileys', icon: 'mood', label: 'Smileys and people', emoji: SMILEYS },
  { key: 'nature', icon: 'pets', label: 'Animals and nature', emoji: NATURE },
  { key: 'food', icon: 'restaurant', label: 'Food and drink', emoji: FOOD },
  { key: 'activity', icon: 'sports-soccer', label: 'Activity', emoji: ACTIVITY },
  { key: 'travel', icon: 'flight', label: 'Travel and places', emoji: TRAVEL },
  { key: 'objects', icon: 'lightbulb', label: 'Objects', emoji: OBJECTS },
  { key: 'symbols', icon: 'favorite', label: 'Symbols', emoji: SYMBOLS },
];

/**
 * Every emoji this build can actually draw.
 *
 * The recent row is the one place an emoji arrives from OUTSIDE these lists:
 * it is whatever was saved on this device, possibly by a build whose lists
 * were longer. Filtering it through this set is what makes trimming the lists
 * actually fix a phone that has already saved a glyph it cannot render.
 */
const SUPPORTED = new Set(GROUPS.flatMap((group) => group.emoji));

/** Target width of one emoji key, before the row is shared out evenly. */
const KEY_WIDTH = 44;

/**
 * The panel itself.
 *
 * `height` is the keyboard's last known height, handed down so the swap
 * between the two does not move the composer — the whole point of putting the
 * panel here rather than over the thread.
 */
export function EmojiPanel({
  height,
  onPick,
  onBackspace,
}: {
  height: number;
  onPick: (emoji: string) => void;
  /**
   * Delete one character, like the keyboard's own backspace.
   *
   * Omitted where there is nothing to delete into — picking a tap-back, where
   * the panel is choosing one emoji rather than composing with them.
   */
  onBackspace?: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const recent = useRecentEmoji();
  const [active, setActive] = useState<GroupKey>(recent.length > 0 ? 'recent' : 'smileys');

  // Whole keys only, so the last column isn't a sliver. Capped at a tablet's
  // worth of width, past which more columns would just spread the same few
  // hundred emoji thinner.
  const columns = Math.max(6, Math.floor(Math.min(width, 520) / KEY_WIDTH));

  /**
   * A share of the row, as a fixed width.
   *
   * NOT `flex: 1`. Flex divides the row between the cells that are in it, so
   * a last row holding three emoji spread them across the whole screen and a
   * row holding one centred it — which is what made the recent tab look like
   * it had been shuffled. A fixed share leaves a part-full row aligned under
   * the full ones above it.
   */
  const keyWidth = `${100 / columns}%` as const;

  const data = useMemo(() => {
    if (active === 'recent') return recent.filter((emoji) => SUPPORTED.has(emoji));
    return GROUPS.find((group) => group.key === active)?.emoji ?? [];
  }, [active, recent]);

  const pick = (emoji: string) => {
    recordRecentEmoji(emoji);
    onPick(emoji);
  };

  return (
    <View style={[styles.panel, { height }]}>
      <View style={styles.tabs}>
        {GROUPS.map((group) => {
          const on = group.key === active;
          return (
            <Pressable
              key={group.key}
              onPress={() => setActive(group.key)}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={group.label}>
              <MaterialIcons
                name={group.icon}
                size={20}
                color={on ? theme.accentTint : theme.textSecondary}
              />
              {/* The one piece of state the icon alone can't carry: which tab
                  you are on reads as a position, not as a shade of grey. */}
              <View
                style={[
                  styles.tabRule,
                  { backgroundColor: on ? theme.accentTint : 'transparent' },
                ]}
              />
            </Pressable>
          );
        })}

        {onBackspace && (
          <Pressable
            onPress={onBackspace}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Delete the character before the cursor">
            <MaterialIcons name="backspace" size={19} color={theme.textSecondary} />
            <View style={styles.tabRule} />
          </Pressable>
        )}
      </View>

      <FlatList
        // numColumns can't change on a live list, and nor can the data's shape
        // when the grid is rebuilt — so both go in the key and the list simply
        // starts again, which is also the scroll-to-top a new tab wants.
        key={`${active}-${columns}`}
        data={data}
        keyExtractor={(emoji, index) => `${emoji}-${index}`}
        numColumns={columns}
        style={styles.grid}
        // The panel stands in for the keyboard, which means it reaches the
        // bottom of the screen and over the navigation bar with it. The last
        // row of keys has to clear that, or it can't be tapped.
        contentContainerStyle={[styles.gridContent, { paddingBottom: insets.bottom + Spacing.three }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // A few hundred keys of plain text: cheap to draw, and windowing them
        // makes the scroll blank out on a fast flick.
        initialNumToRender={120}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => pick(item)}
            style={({ pressed }) => [styles.key, { width: keyWidth }, pressed && styles.keyPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Insert ${item}`}>
            {/* Deliberately RN's own <Text>, not <ThemedText>: the app's font
                has no emoji in it, and naming it invites the system fallback
                to draw them at a different size from row to row. */}
            <Text style={styles.keyText}>{item}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            {active === 'recent'
              ? 'Emoji you use will collect here.'
              : 'Nothing in this group.'}
          </ThemedText>
        }
      />
    </View>
  );
}

/**
 * The same panel, as a sheet.
 *
 * For the one case the in-place panel can't serve: picking a tap-back from
 * the long-press sheet, where there is no composer to take the keyboard's
 * place and nothing on screen the panel could slot into.
 */
export function EmojiPickerSheet({
  visible,
  onPick,
  onClose,
}: {
  visible: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { height } = useWindowDimensions();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss">
        {/* Swallows taps so pressing the sheet itself doesn't close it. */}
        <Pressable onPress={() => {}} style={[styles.sheet, theme.glassOverlay]}>
          <View style={[styles.grabber, { backgroundColor: theme.backgroundSelected }]} />
          <EmojiPanel
            // Just over half the screen: tall enough for four rows of keys,
            // short enough that the message being reacted to stays in view.
            height={Math.round(height * 0.46)}
            onPick={(emoji) => {
              onClose();
              onPick(emoji);
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    borderBottomWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderTopLeftRadius: Radius.large,
    borderTopRightRadius: Radius.large,
    paddingTop: Spacing.two,
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: Radius.full,
    marginBottom: Spacing.two,
  },
  panel: {
    width: '100%',
  },
  tabs: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: Spacing.two,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  tabRule: {
    height: 2,
    width: 18,
    borderRadius: Radius.full,
  },
  grid: {
    flex: 1,
  },
  gridContent: {
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.two,
  },
  key: {
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: {
    opacity: 0.45,
  },
  keyText: {
    fontSize: 26,
    // Android reserves room above and below a glyph for the font's own ascent
    // and descent, which on an emoji is enough to clip the bottom of the row.
    lineHeight: 34,
  },
  pressed: {
    opacity: 0.6,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.four,
  },
});
