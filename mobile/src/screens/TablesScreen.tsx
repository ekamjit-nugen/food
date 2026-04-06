import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTables, type DiningTable } from '../lib/tables';
import { useOpenOrders, type Order } from '../lib/orders';
import { useCreateAlert, type ServiceAlertKind } from '../lib/alerts';
import type { TablesProps } from '../lib/navigation';

/**
 * Tables grid — mobile home after pairing.
 *
 * Two queries drive this screen: the table list (rarely changes) and the
 * open-orders list (changes every shift). We join them locally into a map
 * keyed by tableId so each cell can render "free" or "Order #N" in O(1).
 *
 * The header shows the signed-in staff name plus a sign-out affordance —
 * we deliberately put sign-out on the home screen, not buried in settings,
 * because a paired device is easy to lose and the friend's manager needs a
 * visible "unpair this" button for fast recovery.
 */
export function TablesScreen({ navigation }: TablesProps) {
  const { state, signOut } = useAuth();
  const tables = useTables();
  const openOrders = useOpenOrders();
  const createAlert = useCreateAlert();

  const raiseAlert = useCallback(
    async (kind: ServiceAlertKind) => {
      try {
        await createAlert.mutateAsync({ kind });
        const label =
          kind === 'call_manager'
            ? 'Manager'
            : kind === 'call_kitchen'
              ? 'Kitchen'
              : 'Waiter';
        Alert.alert('Alert sent', `${label} has been notified.`);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Failed to send alert';
        Alert.alert('Alert failed', msg);
      }
    },
    [createAlert],
  );

  const openByTable = useMemo(() => {
    const m = new Map<string, Order>();
    for (const o of openOrders.data ?? []) {
      if (o.tableId) m.set(o.tableId, o);
    }
    return m;
  }, [openOrders.data]);

  const onRefresh = useCallback(() => {
    void tables.refetch();
    void openOrders.refetch();
  }, [tables, openOrders]);

  const onPickTable = useCallback(
    (t: DiningTable) => {
      const active = openByTable.get(t.id);
      if (active) {
        navigation.navigate('Order', { orderId: active.id, tableCode: t.code });
      } else {
        navigation.navigate('Order', { tableId: t.id, tableCode: t.code });
      }
    },
    [navigation, openByTable],
  );

  const confirmSignOut = () => {
    Alert.alert('Sign out', 'This will unpair the device. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  // Open takeaway orders (tableless) shown above the grid
  const openTakeaways = useMemo(
    () => (openOrders.data ?? []).filter((o) => o.orderType === 'takeaway' && o.status === 'open'),
    [openOrders.data],
  );

  const user = state.status === 'authenticated' ? state.user : null;
  const canManageStock =
    !!user && (user.isTenantOwner || user.role === 'admin' || user.role === 'manager');
  const loading = tables.isLoading || openOrders.isLoading;
  const error = tables.error ?? openOrders.error;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Tables</Text>
          {user ? <Text style={styles.subtitle}>{user.fullName}</Text> : null}
        </View>
        {canManageStock ? (
          <Pressable
            onPress={() => navigation.navigate('Stock')}
            hitSlop={12}
            style={styles.headerLink}
          >
            <Text style={styles.headerLinkText}>Stock</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={confirmSignOut} hitSlop={12}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      <View style={styles.alertBar}>
        <AlertButton
          label="Call manager"
          color="#2563eb"
          busy={createAlert.isPending}
          onPress={() => void raiseAlert('call_manager')}
        />
        <AlertButton
          label="Call kitchen"
          color="#b45309"
          busy={createAlert.isPending}
          onPress={() => void raiseAlert('call_kitchen')}
        />
        <AlertButton
          label="Call waiter"
          color="#0f766e"
          busy={createAlert.isPending}
          onPress={() => void raiseAlert('call_waiter')}
        />
      </View>

      <View style={styles.takeawayBar}>
        <Pressable
          onPress={() => navigation.navigate('Order', { orderType: 'takeaway' })}
          style={({ pressed }) => [styles.takeawayBtn, pressed && styles.takeawayBtnPressed]}
        >
          <Text style={styles.takeawayBtnText}>+ New takeaway</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{(error as Error).message}</Text>
        </View>
      ) : null}

      {loading && !tables.data ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        <FlatList
          data={tables.data ?? []}
          keyExtractor={(t) => t.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TableCard
              table={item}
              activeOrder={openByTable.get(item.id) ?? null}
              onPress={() => onPickTable(item)}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={tables.isFetching} onRefresh={onRefresh} tintColor="#fff" />
          }
          ListHeaderComponent={
            openTakeaways.length > 0 ? (
              <View style={styles.takeawaySection}>
                <Text style={styles.sectionLabel}>Open takeaway orders</Text>
                <View style={styles.takeawayGrid}>
                  {openTakeaways.map((o) => (
                    <Pressable
                      key={o.id}
                      onPress={() => navigation.navigate('Order', { orderId: o.id })}
                      style={({ pressed }) => [
                        styles.takeawayCard,
                        pressed && styles.cardPressed,
                      ]}
                    >
                      <Text style={styles.cardCode}>#{o.orderNumber}</Text>
                      {o.customerName ? (
                        <Text style={styles.cardLabel}>{o.customerName}</Text>
                      ) : null}
                      <Text style={styles.takeawayLabel}>Takeaway</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No tables configured. Ask admin to add tables.</Text>
          }
        />
      )}
    </View>
  );
}

function AlertButton({
  label,
  color,
  busy,
  onPress,
}: {
  label: string;
  color: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [
        styles.alertBtn,
        { backgroundColor: color },
        busy && styles.alertBtnDim,
        pressed && !busy && styles.alertBtnPressed,
      ]}
    >
      <Text style={styles.alertBtnText}>{label}</Text>
    </Pressable>
  );
}

function TableCard({
  table,
  activeOrder,
  onPress,
}: {
  table: DiningTable;
  activeOrder: Order | null;
  onPress: () => void;
}) {
  const occupied = !!activeOrder;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        occupied ? styles.cardOccupied : styles.cardFree,
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardCode}>{table.code}</Text>
        <Text style={styles.cardSeats}>{table.seats} seats</Text>
      </View>
      {table.label ? <Text style={styles.cardLabel}>{table.label}</Text> : null}
      <Text style={[styles.cardStatus, occupied ? styles.cardStatusOcc : styles.cardStatusFree]}>
        {occupied ? `Order #${activeOrder.orderNumber}` : 'Free'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 16,
  },
  title: { fontSize: 28, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: 13, color: '#94a3b8', marginTop: 2 },
  headerLink: { paddingHorizontal: 10 },
  headerLinkText: { color: '#60a5fa', fontSize: 14, fontWeight: '600' },
  signOut: { color: '#f87171', fontSize: 14, fontWeight: '600' },
  alertBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  alertBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 3,
  },
  alertBtnDim: { opacity: 0.5 },
  alertBtnPressed: { opacity: 0.8 },
  alertBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  errorBox: {
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: '#7f1d1d',
    borderRadius: 8,
    padding: 12,
  },
  errorText: { color: '#fecaca', fontSize: 13 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { justifyContent: 'space-between', marginBottom: 12 },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 40 },
  card: {
    flex: 1,
    marginHorizontal: 4,
    borderRadius: 12,
    padding: 16,
    minHeight: 110,
    borderWidth: 1,
  },
  cardFree: { backgroundColor: '#1e293b', borderColor: '#334155' },
  cardOccupied: { backgroundColor: '#422006', borderColor: '#b45309' },
  cardPressed: { opacity: 0.7 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  cardCode: { fontSize: 20, fontWeight: '700', color: '#fff' },
  cardSeats: { fontSize: 11, color: '#94a3b8' },
  cardLabel: { fontSize: 13, color: '#cbd5e1', marginTop: 4 },
  cardStatus: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', marginTop: 12, letterSpacing: 0.5 },
  cardStatusFree: { color: '#34d399' },
  cardStatusOcc: { color: '#fbbf24' },
  takeawayBar: { paddingHorizontal: 16, paddingBottom: 12 },
  takeawayBtn: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  takeawayBtnPressed: { opacity: 0.7 },
  takeawayBtnText: { color: '#a78bfa', fontSize: 14, fontWeight: '600' },
  takeawaySection: { marginBottom: 16 },
  sectionLabel: {
    color: '#94a3b8',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600',
    marginBottom: 8,
  },
  takeawayGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  takeawayCard: {
    backgroundColor: '#2e1065',
    borderColor: '#7c3aed',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    minWidth: '47%',
    flex: 1,
    marginHorizontal: 4,
    marginBottom: 8,
  },
  takeawayLabel: {
    color: '#a78bfa',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    marginTop: 12,
    letterSpacing: 0.5,
  },
});
