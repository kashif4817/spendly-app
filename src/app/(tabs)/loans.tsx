import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useRouter, type Href } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddButton } from '@/components/add-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MoneyColors } from '@/constants/app';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { getLedgerTotals, getPeople, type PersonBalance } from '@/db';
import { useQuery } from '@/db/hooks';
import { useTheme } from '@/hooks/use-theme';
import { formatRelativeDay } from '@/lib/date';
import { formatMoney } from '@/lib/money';

const SETTLED_EPSILON = 0.005;

export default function PeopleScreen() {
  const theme = useTheme();
  const router = useRouter();

  const people = useQuery(() => getPeople());
  const totals = useQuery(() => getLedgerTotals());

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <FlatList
          data={people}
          keyExtractor={(item) => item.person}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.header}>
              <ThemedText type="title" style={styles.title}>
                Loans
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Who owes you, and who you owe
              </ThemedText>
              <View style={styles.tiles}>
                <View style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="small" themeColor="textSecondary">
                    You’ll get
                  </ThemedText>
                  <ThemedText style={[styles.tileValue, { color: MoneyColors.in }]}>
                    {formatMoney(totals.receivable)}
                  </ThemedText>
                </View>
                <View style={[styles.tile, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="small" themeColor="textSecondary">
                    You’ll pay
                  </ThemedText>
                  <ThemedText style={[styles.tileValue, { color: MoneyColors.out }]}>
                    {formatMoney(totals.payable)}
                  </ThemedText>
                </View>
              </View>
            </View>
          }
          renderItem={({ item }) => (
            <PersonRow
              person={item}
              onPress={() =>
                router.push(`/person?person=${encodeURIComponent(item.person)}` as Href)
              }
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <ThemedText style={styles.emptyEmoji}>🤝</ThemedText>
              <ThemedText type="smallBold">No loans yet</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyHint}>
                Tap “＋ Add” to record money you gave to or took from someone.
              </ThemedText>
            </View>
          }
        />
      </SafeAreaView>
      <AddButton href={'/ledger' as Href} />
    </ThemedView>
  );
}

function PersonRow({ person, onPress }: { person: PersonBalance; onPress: () => void }) {
  const theme = useTheme();
  const { balance } = person;
  const settled = Math.abs(balance) < SETTLED_EPSILON;
  const owesYou = balance > 0;
  const color = owesYou ? MoneyColors.in : MoneyColors.out;
  const initial = person.person.trim().charAt(0).toUpperCase() || '?';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement },
        pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button">
      <View style={[styles.avatar, { backgroundColor: theme.backgroundSelected }]}>
        <ThemedText style={[styles.rowInitial, { color: settled ? theme.textSecondary : color }]}>
          {initial}
        </ThemedText>
      </View>

      <View style={styles.middle}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.personName}>
          {person.person}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {settled ? 'Settled up' : owesYou ? 'Owes you' : 'You owe'} ·{' '}
          {formatRelativeDay(person.lastDay)}
        </ThemedText>
      </View>

      <View style={styles.right}>
        <ThemedText
          type="smallBold"
          style={[styles.balanceValue, { color: settled ? theme.textSecondary : color }]}>
          {formatMoney(Math.abs(balance))}
        </ThemedText>
        <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.six,
  },
  header: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  title: {
    fontSize: 40,
    lineHeight: 46,
  },
  tiles: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
    marginBottom: Spacing.two,
  },
  tile: {
    flex: 1,
    borderRadius: 16,
    padding: Spacing.three,
    gap: 2,
  },
  tileValue: {
    fontSize: 22,
    fontWeight: '700',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: 16,
    marginBottom: Spacing.two,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInitial: {
    fontSize: 20,
    fontWeight: '700',
  },
  middle: {
    flex: 1,
    gap: 2,
  },
  personName: {
    fontSize: 16,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  balanceValue: {
    fontSize: 16,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.six,
  },
  emptyEmoji: {
    fontSize: 40,
    marginBottom: Spacing.one,
  },
  emptyHint: {
    textAlign: 'center',
  },
});
