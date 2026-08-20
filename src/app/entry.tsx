import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CURRENCY, MoneyColors } from '@/constants/app';
import { CATEGORY_EMOJIS } from '@/constants/categories';
import { Spacing } from '@/constants/theme';
import {
  addCategory,
  addTransaction,
  deleteTransaction,
  getCategories,
  getCurrentUserId,
  getTransaction,
  renameCategory,
  setTransactionReceipt,
  updateCategoryEmoji,
  updateTransaction,
  type Category,
  type EntryType,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatRelativeDay, todayKey } from '@/lib/date';
import { parseAmount } from '@/lib/money';
import {
  captureWithCamera,
  compressReceipt,
  deleteReceipt,
  pickFromLibrary,
  receiptUrl,
  ReceiptError,
  uploadReceipt,
  type PickedReceipt,
} from '@/lib/receipts';

/** Icon a brand-new category starts with until the user picks another. */
const NEW_CAT_EMOJI = '🏷️';

export default function EntryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; day?: string }>();
  const editId = params.id ?? null;

  // Load the existing entry once when editing.
  const existing = useMemo(() => (editId ? getTransaction(editId) : null), [editId]);

  const [type, setType] = useState<EntryType>(existing?.type ?? 'out');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  // A new entry defaults to the day the user picked on the calendar (falling
  // back to today); editing always keeps the entry's own date.
  const [day, setDay] = useState(existing?.day ?? params.day ?? todayKey());

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newCategoryEmoji, setNewCategoryEmoji] = useState(NEW_CAT_EMOJI);
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const [catSearch, setCatSearch] = useState('');
  // When set, the sheet swaps its list for the icon grid: either an existing
  // category being re-iconed, or 'new' for the one being created.
  const [iconTarget, setIconTarget] = useState<Category | 'new' | null>(null);
  // Long-pressing a category swaps its row for an inline rename field.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  // Receipt: `pending` is a freshly picked photo not yet uploaded; `receiptPath`
  // is the stored path (existing or after upload); `receiptView` is its signed URL.
  const [pending, setPending] = useState<PickedReceipt | null>(null);
  const [receiptPath, setReceiptPath] = useState<string | null>(existing?.receipt_path ?? null);
  const [receiptView, setReceiptView] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const categories = useQuery(() => getCategories(type), [type]);
  const accent = type === 'in' ? MoneyColors.in : MoneyColors.out;
  const selectedCat = categories.find((c) => c.name === category) ?? null;

  const visibleCategories = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, catSearch]);

  function closeCatMenu() {
    setCatMenuOpen(false);
    setAddingCategory(false);
    setNewCategory('');
    setNewCategoryEmoji(NEW_CAT_EMOJI);
    setCatSearch('');
    setIconTarget(null);
    cancelRename();
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameText('');
  }

  function startRename(cat: Category) {
    setRenamingId(cat.id);
    setRenameText(cat.name);
  }

  /** Commit an inline rename, keeping the current selection pointed at it. */
  function saveRename(cat: Category) {
    const next = renameText.trim();
    if (!next || next === cat.name) {
      cancelRename();
      return;
    }
    const result = renameCategory(cat.id, next);
    if (result === 'duplicate') {
      Alert.alert(
        'Name already used',
        `Another ${cat.type === 'in' ? 'income' : 'expense'} category is already called “${next}”.`
      );
      return;
    }
    if (result !== 'ok') {
      cancelRename();
      return;
    }
    // Entries reference categories by name, so follow the rename here too.
    if (category === cat.name) setCategory(next);
    cancelRename();
  }

  /** Apply the tapped emoji to whichever target opened the icon grid. */
  function pickEmoji(emoji: string) {
    if (iconTarget === 'new') setNewCategoryEmoji(emoji);
    else if (iconTarget) updateCategoryEmoji(iconTarget.id, emoji);
    setIconTarget(null);
  }

  /** Start creating a category, seeded with whatever was typed in the search. */
  function startAddingCategory() {
    setNewCategory(catSearch.trim());
    setAddingCategory(true);
  }

  // Resolve a signed URL for an already-stored receipt.
  useEffect(() => {
    let active = true;
    if (receiptPath) receiptUrl(receiptPath).then((u) => active && setReceiptView(u));
    else setReceiptView(null);
    return () => {
      active = false;
    };
  }, [receiptPath]);

  const previewUri = pending?.uri ?? receiptView;

  function chooseType(next: EntryType) {
    setType(next);
    if (!getCategories(next).some((c) => c.name === category)) {
      setCategory('');
    }
  }

  function saveNewCategory() {
    const name = newCategory.trim();
    if (!name) return;
    const saved = addCategory(name, newCategoryEmoji, type);
    setCategory(saved);
    closeCatMenu();
  }

  function attach() {
    Alert.alert('Add receipt', 'Attach a photo of your receipt.', [
      { text: 'Take photo', onPress: () => addFrom('camera') },
      { text: 'Choose from gallery', onPress: () => addFrom('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function addFrom(source: 'camera' | 'library') {
    try {
      const raw = source === 'camera' ? await captureWithCamera() : await pickFromLibrary();
      if (!raw) return;
      setPending(await compressReceipt(raw));
    } catch {
      Alert.alert('Couldn’t add photo', 'Please try again.');
    }
  }

  async function removeReceipt() {
    if (pending) {
      setPending(null);
      return;
    }
    if (receiptPath && editId) {
      const path = receiptPath;
      setReceiptPath(null);
      try {
        await deleteReceipt(path);
        setTransactionReceipt(editId, null);
      } catch {
        // best-effort; the row is already unlinked locally
      }
    }
  }

  async function onSave() {
    const value = parseAmount(amount);
    if (value <= 0) {
      Alert.alert('Enter an amount', 'The amount must be greater than zero.');
      return;
    }
    if (!category) {
      Alert.alert('Pick a category', 'Choose a category for this entry.');
      return;
    }

    const payload = { type, amount: value, category, note: note.trim(), day };
    setSaving(true);
    let id = editId;
    try {
      if (editId) updateTransaction(editId, payload);
      else id = addTransaction(payload);

      if (pending && id) {
        const userId = getCurrentUserId();
        if (userId) {
          try {
            setTransactionReceipt(id, await uploadReceipt(userId, id, pending));
          } catch (e) {
            const quota = e instanceof ReceiptError && e.code === 'quota';
            Alert.alert(
              'Receipt not attached',
              quota
                ? 'You’ve reached your 100 MB receipt limit. Delete some receipts and try again.'
                : 'Couldn’t upload the receipt (are you online?). Your entry was saved without it.'
            );
          }
        }
      }
    } finally {
      setSaving(false);
    }
    router.back();
  }

  /** Add a fresh copy of this entry dated today (for repeat spends). */
  function onDuplicate() {
    const value = parseAmount(amount);
    if (value <= 0 || !category) {
      Alert.alert('Can’t duplicate', 'Enter an amount and pick a category first.');
      return;
    }
    addTransaction({ type, amount: value, category, note: note.trim(), day: todayKey() });
    router.back();
  }

  function onDelete() {
    if (!editId) return;
    Alert.alert('Delete entry', 'This entry will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (receiptPath) deleteReceipt(receiptPath).catch(() => {});
          deleteTransaction(editId);
          router.back();
        },
      },
    ]);
  }

  const isToday = day === todayKey();

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: editId ? 'Edit entry' : 'Add entry' }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {/* In / Out */}
          <Segmented
            value={type}
            onChange={chooseType}
            options={[
              { label: 'Money out', value: 'out', color: MoneyColors.out },
              { label: 'Money in', value: 'in', color: MoneyColors.in },
            ]}
          />

          {/* Amount */}
          <View style={[styles.amountRow, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText style={[styles.currency, { color: accent }]}>{CURRENCY}</ThemedText>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0"
              placeholderTextColor={theme.textSecondary}
              keyboardType="decimal-pad"
              style={[styles.amountInput, { color: theme.text }]}
              autoFocus={!editId}
            />
          </View>

          {/* Category */}
          <ThemedText type="smallBold" style={styles.label}>
            Category
          </ThemedText>
          <Pressable
            onPress={() => setCatMenuOpen(true)}
            style={[styles.selectField, { backgroundColor: theme.backgroundElement }]}>
            {selectedCat ? (
              <View style={styles.selectValue}>
                <ThemedText style={styles.chipEmoji}>{selectedCat.emoji}</ThemedText>
                <ThemedText style={{ color: theme.text }}>{selectedCat.name}</ThemedText>
              </View>
            ) : (
              <ThemedText themeColor="textSecondary">Select a category</ThemedText>
            )}
            <MaterialIcons name="expand-more" size={24} color={theme.textSecondary} />
          </Pressable>

          {/* Note */}
          <ThemedText type="smallBold" style={styles.label}>
            Note (optional)
          </ThemedText>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Lunch with team"
            placeholderTextColor={theme.textSecondary}
            style={[styles.noteInput, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          />

          {/* Receipt */}
          <ThemedText type="smallBold" style={styles.label}>
            Receipt (optional)
          </ThemedText>
          {previewUri ? (
            <View style={[styles.receiptRow, { backgroundColor: theme.backgroundElement }]}>
              <Pressable onPress={() => setViewerOpen(true)}>
                <Image source={{ uri: previewUri }} style={styles.thumb} contentFit="cover" />
              </Pressable>
              <View style={styles.receiptInfo}>
                <ThemedText type="small" themeColor="textSecondary">
                  {pending ? 'New photo — uploads when you save' : 'Tap to view'}
                </ThemedText>
                <Pressable onPress={removeReceipt} hitSlop={8}>
                  <ThemedText type="smallBold" style={{ color: MoneyColors.out }}>
                    Remove
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={attach}
              style={[styles.attachBtn, { borderColor: theme.backgroundSelected }]}>
              <MaterialIcons name="add-a-photo" size={20} color={theme.textSecondary} />
              <ThemedText type="small" themeColor="textSecondary">
                Attach a photo
              </ThemedText>
            </Pressable>
          )}

          {/* Date */}
          <ThemedText type="smallBold" style={styles.label}>
            Date
          </ThemedText>
          <View style={[styles.dateRow, { backgroundColor: theme.backgroundElement }]}>
            <Pressable onPress={() => setDay(addDays(day, -1))} hitSlop={8} style={styles.stepper}>
              <ThemedText style={styles.stepperText}>‹</ThemedText>
            </Pressable>
            <View style={styles.dateMiddle}>
              <ThemedText type="smallBold">{formatRelativeDay(day)}</ThemedText>
              {!isToday && (
                <Pressable onPress={() => setDay(todayKey())} hitSlop={6}>
                  <ThemedText type="small" style={{ color: accent }}>
                    Jump to today
                  </ThemedText>
                </Pressable>
              )}
            </View>
            <Pressable
              onPress={() => !isToday && setDay(addDays(day, 1))}
              hitSlop={8}
              style={styles.stepper}>
              <ThemedText style={[styles.stepperText, isToday && { opacity: 0.3 }]}>›</ThemedText>
            </Pressable>
          </View>

          {/* Save */}
          <Pressable
            onPress={onSave}
            disabled={saving}
            style={({ pressed }) => [
              styles.saveButton,
              { backgroundColor: accent },
              pressed && { opacity: 0.85 },
            ]}>
            {saving ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <ThemedText style={styles.saveText}>
                {editId ? 'Save changes' : 'Add entry'}
              </ThemedText>
            )}
          </Pressable>

          {editId && (
            <>
              <Pressable onPress={onDuplicate} style={styles.duplicateButton} hitSlop={8}>
                <ThemedText type="smallBold" style={{ color: accent }}>
                  Duplicate for today
                </ThemedText>
              </Pressable>
              <Pressable onPress={onDelete} style={styles.deleteButton} hitSlop={8}>
                <ThemedText type="smallBold" style={{ color: MoneyColors.out }}>
                  Delete entry
                </ThemedText>
              </Pressable>
            </>
          )}

          <SafeAreaView edges={['bottom']} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Full-screen receipt viewer */}
      <Modal
        visible={viewerOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setViewerOpen(false)}>
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewerOpen(false)}>
          {previewUri && (
            <Image source={{ uri: previewUri }} style={styles.viewerImage} contentFit="contain" />
          )}
        </Pressable>
      </Modal>

      {/* Category picker */}
      <Modal
        visible={catMenuOpen}
        transparent
        animationType="slide"
        onRequestClose={closeCatMenu}>
        <Pressable style={styles.catBackdrop} onPress={closeCatMenu}>
          <Pressable style={[styles.catSheet, { backgroundColor: theme.background }]}>
            <View style={styles.catHandle} />

            {iconTarget ? (
              <>
                {/* Icon grid — replaces the list while an icon is being chosen */}
                <View style={styles.iconHead}>
                  <Pressable onPress={() => setIconTarget(null)} hitSlop={8} style={styles.iconBack}>
                    <MaterialIcons name="arrow-back" size={22} color={theme.text} />
                  </Pressable>
                  <ThemedText type="smallBold" style={styles.iconTitle} numberOfLines={1}>
                    {iconTarget === 'new'
                      ? 'Icon for the new category'
                      : `Icon for ${iconTarget.name}`}
                  </ThemedText>
                </View>
                <ScrollView style={styles.catList} showsVerticalScrollIndicator={false}>
                  <View style={styles.iconGrid}>
                    {CATEGORY_EMOJIS.map((emoji) => {
                      const current =
                        emoji === (iconTarget === 'new' ? newCategoryEmoji : iconTarget.emoji);
                      return (
                        <Pressable
                          key={emoji}
                          onPress={() => pickEmoji(emoji)}
                          style={({ pressed }) => [
                            styles.iconCell,
                            { backgroundColor: theme.backgroundElement },
                            current && { borderColor: accent, borderWidth: 2 },
                            pressed && { opacity: 0.6 },
                          ]}>
                          <ThemedText style={styles.iconCellEmoji}>{emoji}</ThemedText>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
              </>
            ) : (
              <>
                <ThemedText type="smallBold" style={styles.catSheetTitle}>
                  {type === 'in' ? 'Income category' : 'Expense category'}
                </ThemedText>

                {/* Search */}
                <View style={[styles.searchRow, { backgroundColor: theme.backgroundElement }]}>
                  <MaterialIcons name="search" size={20} color={theme.textSecondary} />
                  <TextInput
                    value={catSearch}
                    onChangeText={setCatSearch}
                    placeholder={
                      type === 'in' ? 'Search income categories' : 'Search expense categories'
                    }
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.searchInput, { color: theme.text }]}
                  />
                  {catSearch.length > 0 && (
                    <Pressable onPress={() => setCatSearch('')} hitSlop={8}>
                      <MaterialIcons name="close" size={20} color={theme.textSecondary} />
                    </Pressable>
                  )}
                </View>

                {addingCategory ? (
                  <View style={[styles.addRow, { backgroundColor: theme.backgroundElement }]}>
                    <Pressable onPress={() => setIconTarget('new')} hitSlop={6}>
                      <ThemedText style={styles.optionEmoji}>{newCategoryEmoji}</ThemedText>
                    </Pressable>
                    <TextInput
                      value={newCategory}
                      onChangeText={setNewCategory}
                      placeholder="New category name"
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.addInput, { color: theme.text }]}
                      autoFocus
                      onSubmitEditing={saveNewCategory}
                      returnKeyType="done"
                    />
                    <Pressable onPress={saveNewCategory} hitSlop={8}>
                      <ThemedText type="smallBold" style={{ color: accent }}>
                        Add
                      </ThemedText>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={startAddingCategory} style={styles.optionRow}>
                    <MaterialIcons name="add" size={22} color={accent} style={styles.optionIcon} />
                    <ThemedText style={[styles.optionName, { color: accent }]}>
                      {catSearch.trim() ? `Add “${catSearch.trim()}”` : 'Add new category'}
                    </ThemedText>
                  </Pressable>
                )}

                <ThemedText type="small" themeColor="textSecondary" style={styles.catHint}>
                  Tap a category’s icon to change it, or hold a category to rename it.
                </ThemedText>

                <ScrollView
                  style={styles.catList}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}>
                  {visibleCategories.length === 0 ? (
                    <ThemedText type="small" themeColor="textSecondary" style={styles.catEmpty}>
                      No categories match “{catSearch.trim()}”.
                    </ThemedText>
                  ) : (
                    visibleCategories.map((cat) => {
                      const selected = cat.name === category;

                      if (cat.id === renamingId) {
                        return (
                          <View
                            key={cat.id}
                            style={[
                              styles.optionRow,
                              styles.renameRow,
                              { backgroundColor: theme.backgroundElement },
                            ]}>
                            <Pressable onPress={() => setIconTarget(cat)} hitSlop={8}>
                              <ThemedText style={styles.optionEmoji}>{cat.emoji}</ThemedText>
                            </Pressable>
                            <TextInput
                              value={renameText}
                              onChangeText={setRenameText}
                              placeholder="Category name"
                              placeholderTextColor={theme.textSecondary}
                              style={[styles.addInput, { color: theme.text }]}
                              autoFocus
                              selectTextOnFocus
                              onSubmitEditing={() => saveRename(cat)}
                              returnKeyType="done"
                            />
                            <Pressable onPress={cancelRename} hitSlop={8}>
                              <ThemedText type="smallBold" themeColor="textSecondary">
                                Cancel
                              </ThemedText>
                            </Pressable>
                            <Pressable onPress={() => saveRename(cat)} hitSlop={8}>
                              <ThemedText type="smallBold" style={{ color: accent }}>
                                Save
                              </ThemedText>
                            </Pressable>
                          </View>
                        );
                      }

                      return (
                        <Pressable
                          key={cat.id}
                          onPress={() => {
                            setCategory(cat.name);
                            closeCatMenu();
                          }}
                          onLongPress={() => startRename(cat)}
                          delayLongPress={350}
                          style={styles.optionRow}>
                          <Pressable
                            onPress={() => setIconTarget(cat)}
                            onLongPress={() => startRename(cat)}
                            delayLongPress={350}
                            hitSlop={8}
                            style={({ pressed }) => [
                              styles.optionEmojiBtn,
                              { backgroundColor: theme.backgroundElement },
                              pressed && { opacity: 0.6 },
                            ]}>
                            <ThemedText style={styles.optionEmoji}>{cat.emoji}</ThemedText>
                          </Pressable>
                          <ThemedText style={styles.optionName}>{cat.name}</ThemedText>
                          {selected && <MaterialIcons name="check" size={20} color={accent} />}
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  currency: {
    fontSize: 32,
    fontWeight: '700',
  },
  amountInput: {
    flex: 1,
    fontSize: 40,
    fontWeight: '700',
    paddingVertical: Spacing.two,
  },
  label: {
    marginTop: Spacing.one,
  },
  chipEmoji: {
    fontSize: 18,
  },
  selectField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    minHeight: 52,
  },
  selectValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  catBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  catSheet: {
    maxHeight: '75%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
  },
  catHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#88888855',
    marginBottom: Spacing.two,
  },
  catSheetTitle: {
    paddingHorizontal: Spacing.two,
    marginBottom: Spacing.one,
  },
  catList: {
    flexGrow: 0,
    flexShrink: 1,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  optionEmoji: {
    width: 28,
    fontSize: 18,
    textAlign: 'center',
  },
  renameRow: {
    borderRadius: Spacing.two,
    paddingVertical: Spacing.one,
  },
  optionEmojiBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.one,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Spacing.three,
  },
  catHint: {
    paddingHorizontal: Spacing.two,
    paddingBottom: Spacing.one,
  },
  catEmpty: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.four,
  },
  iconHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    marginBottom: Spacing.two,
  },
  iconBack: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTitle: {
    flex: 1,
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.one,
    paddingBottom: Spacing.two,
  },
  iconCell: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCellEmoji: {
    fontSize: 24,
    lineHeight: 30,
  },
  optionIcon: {
    width: 28,
    textAlign: 'center',
  },
  optionName: {
    flex: 1,
    fontSize: 16,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    marginBottom: Spacing.one,
  },
  addInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Spacing.two,
  },
  noteInput: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Spacing.three,
    padding: Spacing.two,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: '#00000010',
  },
  receiptInfo: {
    flex: 1,
    gap: Spacing.one,
  },
  attachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  stepper: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: {
    fontSize: 28,
    fontWeight: '600',
  },
  dateMiddle: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
    paddingVertical: Spacing.three,
  },
  saveButton: {
    marginTop: Spacing.three,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  saveText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  duplicateButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  deleteButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  viewerImage: {
    width: '100%',
    height: '80%',
  },
});
