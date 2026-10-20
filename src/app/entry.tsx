import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
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

import {
  AmountField,
  DateStepper,
  FormCard,
  FormInput,
  FormLink,
  FormLinks,
  FormRow,
  PrimaryButton,
} from '@/components/form';
import { Segmented } from '@/components/segmented';
import { ActionSheet } from '@/components/action-sheet';
import { confirm, notify } from '@/lib/confirm';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { CATEGORY_ICONS, iconFor } from '@/constants/categories';
import { Radius, Spacing } from '@/constants/theme';
import {
  addCategory,
  addTransaction,
  deleteTransaction,
  getCategories,
  getCurrentUserId,
  getTransaction,
  restoreTransaction,
  renameCategory,
  setTransactionReceipt,
  updateCategoryEmoji,
  updateTransaction,
  type Category,
  type EntryType,
} from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { todayKey } from '@/lib/date';
import { parseAmount } from '@/lib/money';
import { offerUndo } from '@/lib/undo';
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
/** What a brand-new category is drawn with until the user picks something. */
const NEW_CAT_ICON = 'label';

export default function EntryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; day?: string; type?: string }>();
  const editId = params.id ?? null;

  // Load the existing entry once when editing.
  const existing = useMemo(() => (editId ? getTransaction(editId) : null), [editId]);

  // A new entry starts as an expense unless the caller asked for income (the
  // dashboard's "Income" shortcut); editing keeps the entry's own type.
  const [type, setType] = useState<EntryType>(
    existing?.type ?? (params.type === 'in' ? 'in' : 'out')
  );
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  // A new entry defaults to the day the user picked on the calendar (falling
  // back to today); editing always keeps the entry's own date.
  const [day, setDay] = useState(existing?.day ?? params.day ?? todayKey());

  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [newCategoryEmoji, setNewCategoryEmoji] = useState(NEW_CAT_ICON);
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
  const [attachOpen, setAttachOpen] = useState(false);
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
    setNewCategoryEmoji(NEW_CAT_ICON);
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
      notify('Name already used', `Another ${cat.type === 'in' ? 'income' : 'expense'} category is already called “${next}”.`);
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
    setAttachOpen(true);
  }

  async function addFrom(source: 'camera' | 'library') {
    try {
      const raw = source === 'camera' ? await captureWithCamera() : await pickFromLibrary();
      if (!raw) return;
      setPending(await compressReceipt(raw));
    } catch {
      notify('Couldn’t add photo', 'Please try again.');
    }
  }

  function removeReceipt() {
    if (pending) {
      setPending(null);
      return;
    }
    // Keep the old cloud file until the edit is saved so Undo can relink it.
    setReceiptPath(null);
  }

  async function onSave() {
    const value = parseAmount(amount);
    if (value <= 0) {
      notify('Enter an amount', 'The amount must be greater than zero.');
      return;
    }
    if (!category) {
      notify('Pick a category', 'Choose a category for this entry.');
      return;
    }

    const payload = { type, amount: value, category, note: note.trim(), day };
    setSaving(true);
    const before = existing;
    let id = editId;
    let savedReceiptPath: string | null = null;
    try {
      if (editId) updateTransaction(editId, payload);
      else id = addTransaction(payload);

      if (pending && id) {
        const userId = getCurrentUserId();
        if (userId) {
          try {
            savedReceiptPath = await uploadReceipt(
              userId,
              editId ? `${id}-${Date.now()}` : id,
              pending
            );
            setTransactionReceipt(id, savedReceiptPath);
          } catch (e) {
            const quota = e instanceof ReceiptError && e.code === 'quota';
            notify('Receipt not attached', quota
                ? 'You’ve reached your 100 MB receipt limit. Delete some receipts and try again.'
                : 'Couldn’t upload the receipt (are you online?). Your entry was saved without it.');
          }
        }
      }

      if (editId && before && !pending && receiptPath !== before.receipt_path) {
        setTransactionReceipt(editId, receiptPath);
      }
    } finally {
      setSaving(false);
    }
    if (editId && before) {
      const afterReceiptPath = savedReceiptPath ?? (pending ? before.receipt_path : receiptPath);
      offerUndo('Entry updated', () => {
        updateTransaction(editId, {
          type: before.type,
          amount: before.amount,
          category: before.category,
          note: before.note,
          day: before.day,
        });
        setTransactionReceipt(editId, before.receipt_path);
        if (afterReceiptPath && afterReceiptPath !== before.receipt_path) {
          void deleteReceipt(afterReceiptPath).catch(() => {});
        }
      }, 8000, () => {
        if (before.receipt_path && before.receipt_path !== afterReceiptPath) {
          return deleteReceipt(before.receipt_path);
        }
      });
    }
    router.back();
  }

  /** Add a fresh copy of this entry dated today (for repeat spends). */
  function onDuplicate() {
    const value = parseAmount(amount);
    if (value <= 0 || !category) {
      notify('Can’t duplicate', 'Enter an amount and pick a category first.');
      return;
    }
    addTransaction({ type, amount: value, category, note: note.trim(), day: todayKey() });
    router.back();
  }

  function onDelete() {
    if (!editId) return;
    confirm({
      title: 'Delete entry',
      message: 'This removes the entry. You can undo for a few seconds.',
      confirmLabel: 'Delete',
      destructive: true,
      onConfirm: () => {
  const removed = existing ?? getTransaction(editId);
  if (!removed) return;
  deleteTransaction(editId);
  offerUndo(
    'Entry deleted',
    () => restoreTransaction(removed),
    8000,
    () => removed.receipt_path ? deleteReceipt(removed.receipt_path) : undefined
  );
  router.back();
      },
    });
  }

  const isIncome = type === 'in';
  const title = `${editId ? 'Edit' : 'Add'} ${isIncome ? 'income' : 'expense'}`;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Segmented
            value={type}
            onChange={chooseType}
            options={[
              { label: 'Expense', value: 'out', color: MoneyColors.out },
              { label: 'Income', value: 'in', color: MoneyColors.in },
            ]}
          />

          <AmountField value={amount} onChangeText={setAmount} color={accent} autoFocus={!editId} />

          <FormCard>
            <FormRow icon="category" label="Category" onPress={() => setCatMenuOpen(true)} chevron>
              {selectedCat ? (
                <View style={styles.selectValue}>
                  <MaterialIcons name={iconFor(selectedCat.emoji)} size={18} color={theme.text} />
                  <ThemedText type="smallBold">{selectedCat.name}</ThemedText>
                </View>
              ) : (
                <ThemedText themeColor="textSecondary">Choose a category</ThemedText>
              )}
            </FormRow>

            <FormRow icon="notes" label="Note (optional)">
              <FormInput
                value={note}
                onChangeText={setNote}
                placeholder={isIncome ? 'e.g. June salary' : 'e.g. Lunch with team'}
              />
            </FormRow>

            <FormRow icon="event" label="Date">
              <DateStepper day={day} onChange={setDay} color={accent} />
            </FormRow>

            <FormRow icon="receipt-long" label="Receipt (optional)">
              {previewUri ? (
                <View style={styles.receiptRow}>
                  <Pressable onPress={() => setViewerOpen(true)}>
                    <Image source={{ uri: previewUri }} style={styles.thumb} contentFit="cover" />
                  </Pressable>
                  <View style={styles.receiptInfo}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {pending ? 'Uploads when you save' : 'Tap the photo to view'}
                    </ThemedText>
                    <Pressable onPress={removeReceipt} hitSlop={8}>
                      <ThemedText type="smallBold" style={{ color: MoneyColors.out }}>
                        Remove
                      </ThemedText>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable onPress={attach} hitSlop={6} style={styles.attach}>
                  <MaterialIcons name="add-a-photo" size={18} color={theme.accent} />
                  <ThemedText type="smallBold" style={{ color: theme.accent }}>
                    Attach a photo
                  </ThemedText>
                </Pressable>
              )}
            </FormRow>
          </FormCard>

          <PrimaryButton
            label={editId ? 'Save changes' : title}
            onPress={onSave}
            color={accent}
            busy={saving}
          />

          {editId && (
            <FormLinks>
              <FormLink
                label="Duplicate for today"
                icon="content-copy"
                color={theme.accent}
                onPress={onDuplicate}
              />
              <FormLink label="Delete" icon="delete-outline" color={MoneyColors.out} onPress={onDelete} />
            </FormLinks>
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
          <Pressable style={[styles.catSheet, theme.glassOverlay]}>
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
                    {CATEGORY_ICONS.map((name) => {
                      const current =
                        name === iconFor(iconTarget === 'new' ? newCategoryEmoji : iconTarget.emoji);
                      return (
                        <Pressable
                          key={name}
                          onPress={() => pickEmoji(name)}
                          accessibilityRole="button"
                          accessibilityLabel={name.replace(/-/g, ' ')}
                          accessibilityState={{ selected: current }}
                          style={({ pressed }) => [
                            styles.iconCell,
                            theme.glass,
                            current && { borderColor: accent, borderWidth: 2 },
                            pressed && { opacity: 0.6 },
                          ]}>
                          <MaterialIcons
                            name={name}
                            size={22}
                            color={current ? accent : theme.text}
                          />
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
                <View style={[styles.searchRow, theme.glass]}>
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
                  <View style={[styles.addRow, theme.glass]}>
                    <Pressable onPress={() => setIconTarget('new')} hitSlop={6}>
                      <MaterialIcons name={iconFor(newCategoryEmoji)} size={20} color={theme.text} />
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
                              theme.glass,
                            ]}>
                            <Pressable onPress={() => setIconTarget(cat)} hitSlop={8}>
                              <MaterialIcons name={iconFor(cat.emoji)} size={20} color={theme.text} />
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
                              theme.glass,
                              pressed && { opacity: 0.6 },
                            ]}>
                            <MaterialIcons name={iconFor(cat.emoji)} size={20} color={theme.text} />
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

      <ActionSheet
        visible={attachOpen}
        title="Add receipt"
        onClose={() => setAttachOpen(false)}
        actions={[
          { label: 'Take photo', icon: 'photo-camera', onPress: () => addFrom('camera') },
          { label: 'Choose from gallery', icon: 'photo-library', onPress: () => addFrom('library') },
        ]}
      />
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
    borderRadius: Radius.medium,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
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
  receiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  attach: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: 2,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#00000010',
  },
  receiptInfo: {
    flex: 1,
    gap: Spacing.one,
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
