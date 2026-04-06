import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '../lib/api';
import { useServiceMenu, type Item, type ServiceMenuCategory, type Variation } from '../lib/menu';
import {
  useAddOrderItems,
  useCreateOrder,
  useOrderDetail,
  useSendDraftItems,
  type DraftOrderItemInput,
  type OrderItem,
} from '../lib/orders';
import { formatPaise } from '../lib/money';
import type { OrderProps } from '../lib/navigation';

/**
 * Order composer for mobile.
 *
 * Two modes in one screen (matching web's POS):
 *   - NEW: create order + send drafts atomically on "Send to kitchen"
 *   - EXISTING: add items to an open order, then send
 *
 * Layout is a single column: top pane is menu (category picker + item grid),
 * bottom pane is the cart summary with a "Send to kitchen" action. A small
 * "Bill" button appears in the header once the order exists so staff can
 * cross into billing without hunting for it.
 *
 * Cart line signatures match the server's line identity: {menuItemId,
 * variationId, sortedAddonIds, notes}. This lets "regular dosa with ghee"
 * and "regular dosa no ghee" accumulate as two distinct lines that merge
 * on repeat taps.
 */

interface CartLine {
  key: string;
  menuItemId: string;
  menuItemName: string;
  variationId: string | null;
  variationName: string | null;
  addons: Array<{ id: string; name: string; pricePaise: number }>;
  notes: string | null;
  unitPricePaise: number;
  quantity: number;
}

function signatureFor(
  menuItemId: string,
  variationId: string | null,
  addonIds: string[],
  notes: string | null,
): string {
  const addonPart = [...addonIds].sort().join(',');
  return [menuItemId, variationId ?? '', addonPart, notes ?? ''].join('|');
}

export function OrderScreen({ route, navigation }: OrderProps) {
  const paramOrderId = 'orderId' in route.params ? route.params.orderId : undefined;
  const tableId = 'tableId' in route.params ? route.params.tableId : undefined;
  const tableCode = route.params.tableCode;
  const orderTypeParam = 'orderType' in route.params ? route.params.orderType : undefined;
  const mode: 'new' | 'existing' = paramOrderId ? 'existing' : 'new';
  const isTakeaway = orderTypeParam === 'takeaway';

  const orderQuery = useOrderDetail(paramOrderId ?? null);
  const menuQuery = useServiceMenu();
  const createOrder = useCreateOrder();
  const addItems = useAddOrderItems();
  const sendDrafts = useSendDraftItems();

  const [lines, setLines] = useState<CartLine[]>([]);
  const [editorItem, setEditorItem] = useState<Item | null>(null);
  const [activeCatId, setActiveCatId] = useState<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      title:
        mode === 'new'
          ? isTakeaway
            ? 'New takeaway'
            : `New · ${tableCode ?? ''}`.trim()
          : `Order #${orderQuery.data?.orderNumber ?? '…'}${orderQuery.data?.orderType === 'takeaway' ? ' (TA)' : ''}`,
      headerRight: () =>
        mode === 'existing' && paramOrderId ? (
          <Pressable
            onPress={() => navigation.navigate('Bill', { orderId: paramOrderId })}
            hitSlop={8}
          >
            <Text style={styles.headerAction}>Bill</Text>
          </Pressable>
        ) : null,
    });
  }, [mode, navigation, orderQuery.data?.orderNumber, paramOrderId, tableCode]);

  // Default the category picker to the first category once the menu loads.
  useEffect(() => {
    if (!activeCatId && menuQuery.data && menuQuery.data.length > 0) {
      setActiveCatId(menuQuery.data[0]!.id);
    }
  }, [activeCatId, menuQuery.data]);

  const activeCategory = useMemo<ServiceMenuCategory | null>(() => {
    if (!menuQuery.data) return null;
    return menuQuery.data.find((c) => c.id === activeCatId) ?? menuQuery.data[0] ?? null;
  }, [menuQuery.data, activeCatId]);

  const upsertLine = useCallback((line: CartLine) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.key === line.key);
      if (idx === -1) return [...prev, line];
      const current = prev[idx]!;
      const merged = { ...current, quantity: current.quantity + line.quantity };
      const next = [...prev];
      next[idx] = merged;
      return next;
    });
  }, []);

  const adjustLineQty = useCallback((key: string, delta: number) => {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx === -1) return prev;
      const cur = prev[idx]!;
      const q = cur.quantity + delta;
      if (q <= 0) return prev.filter((_, i) => i !== idx);
      const next = [...prev];
      next[idx] = { ...cur, quantity: q };
      return next;
    });
  }, []);

  const onPickItem = useCallback(
    (item: Item) => {
      if (!item.inStock) return;
      const hasOptions = item.variations.some((v) => v.isActive) || item.addons.length > 0;
      if (hasOptions) {
        setEditorItem(item);
        return;
      }
      upsertLine({
        key: signatureFor(item.id, null, [], null),
        menuItemId: item.id,
        menuItemName: item.name,
        variationId: null,
        variationName: null,
        addons: [],
        notes: null,
        unitPricePaise: item.pricePaise,
        quantity: 1,
      });
    },
    [upsertLine],
  );

  const cartTotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.unitPricePaise * l.quantity, 0),
    [lines],
  );

  const draftItems: DraftOrderItemInput[] = useMemo(
    () =>
      lines.map((l) => {
        const item: DraftOrderItemInput = {
          menuItemId: l.menuItemId,
          quantity: l.quantity,
        };
        if (l.variationId) item.variationId = l.variationId;
        if (l.addons.length > 0) item.addonIds = l.addons.map((a) => a.id);
        if (l.notes) item.notes = l.notes;
        return item;
      }),
    [lines],
  );

  const serverSentItems = useMemo<OrderItem[]>(
    () => (orderQuery.data?.items ?? []).filter((i) => !i.isVoid && i.kotId !== null),
    [orderQuery.data],
  );
  const serverDraftItems = useMemo<OrderItem[]>(
    () => (orderQuery.data?.items ?? []).filter((i) => !i.isVoid && i.kotId === null),
    [orderQuery.data],
  );

  const busy = createOrder.isPending || addItems.isPending || sendDrafts.isPending;

  const onSend = useCallback(async () => {
    try {
      if (mode === 'new') {
        if (!isTakeaway && !tableId) {
          Alert.alert('Missing table', 'Go back and pick a table.');
          return;
        }
        if (draftItems.length === 0) {
          Alert.alert('Empty cart', 'Add at least one item before sending.');
          return;
        }
        const created = await createOrder.mutateAsync({
          orderType: isTakeaway ? 'takeaway' : 'dine_in',
          ...(tableId ? { tableId } : {}),
          items: draftItems,
        });
        await sendDrafts.mutateAsync(created.id);
        setLines([]);
        // Replace route so the back button returns to Tables, not to an
        // empty "new order" screen that would create a duplicate.
        navigation.replace('Order', { orderId: created.id, tableCode });
      } else {
        if (!paramOrderId) return;
        if (draftItems.length === 0 && serverDraftItems.length === 0) return;
        if (draftItems.length > 0) {
          await addItems.mutateAsync({ orderId: paramOrderId, items: draftItems });
          // Clear local cart the instant it lands server-side. If the
          // follow-up send fails, the drafts are recoverable via "Send
          // pending drafts" below — do not re-post from the cart.
          setLines([]);
        }
        await sendDrafts.mutateAsync(paramOrderId);
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Send failed';
      Alert.alert('Send failed', msg);
    }
  }, [
    mode,
    tableId,
    tableCode,
    draftItems,
    serverDraftItems.length,
    paramOrderId,
    createOrder,
    addItems,
    sendDrafts,
    navigation,
  ]);

  const onSendOrphanDrafts = useCallback(async () => {
    if (!paramOrderId) return;
    try {
      await sendDrafts.mutateAsync(paramOrderId);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Send failed';
      Alert.alert('Send failed', msg);
    }
  }, [paramOrderId, sendDrafts]);

  const hasServerDrafts = serverDraftItems.length > 0;
  const canSend = lines.length > 0 || (mode === 'existing' && hasServerDrafts);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {menuQuery.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {/* Category strip */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.catStrip}
          >
            {(menuQuery.data ?? []).map((cat) => {
              const selected = cat.id === activeCategory?.id;
              return (
                <Pressable
                  key={cat.id}
                  onPress={() => setActiveCatId(cat.id)}
                  style={[styles.catChip, selected && styles.catChipActive]}
                >
                  <Text style={[styles.catChipText, selected && styles.catChipTextActive]}>
                    {cat.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Item grid */}
          <FlatList
            data={activeCategory?.items ?? []}
            keyExtractor={(i) => i.id}
            numColumns={2}
            columnWrapperStyle={styles.itemRow}
            contentContainerStyle={styles.itemGrid}
            renderItem={({ item }) => <MenuItemCard item={item} onPress={() => onPickItem(item)} />}
            ListEmptyComponent={<Text style={styles.empty}>No items in this category.</Text>}
          />

          {/* Cart summary */}
          <CartPanel
            lines={lines}
            cartTotal={cartTotal}
            onAdjust={adjustLineQty}
            onSend={onSend}
            canSend={canSend}
            busy={busy}
            isExisting={mode === 'existing'}
            serverSentItems={serverSentItems}
            serverDraftItems={serverDraftItems}
            onSendOrphanDrafts={onSendOrphanDrafts}
          />
        </View>
      )}

      {editorItem ? (
        <LineEditor
          item={editorItem}
          onCancel={() => setEditorItem(null)}
          onConfirm={(line) => {
            upsertLine(line);
            setEditorItem(null);
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

// --- Menu item card ----------------------------------------------------------

function MenuItemCard({ item, onPress }: { item: Item; onPress: () => void }) {
  const hasOptions = item.variations.some((v) => v.isActive) || item.addons.length > 0;
  const disabled = !item.inStock;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.itemCard,
        disabled && styles.itemCardDisabled,
        pressed && !disabled && styles.itemCardPressed,
      ]}
    >
      <Text style={styles.itemName} numberOfLines={2}>
        {item.name}
      </Text>
      <Text style={styles.itemPrice}>{formatPaise(item.pricePaise)}</Text>
      {hasOptions ? <Text style={styles.itemOptions}>Options</Text> : null}
      {disabled ? <Text style={styles.itemOut}>Out of stock</Text> : null}
    </Pressable>
  );
}

// --- Cart panel --------------------------------------------------------------

function CartPanel({
  lines,
  cartTotal,
  onAdjust,
  onSend,
  canSend,
  busy,
  isExisting,
  serverSentItems,
  serverDraftItems,
  onSendOrphanDrafts,
}: {
  lines: CartLine[];
  cartTotal: number;
  onAdjust: (key: string, delta: number) => void;
  onSend: () => void;
  canSend: boolean;
  busy: boolean;
  isExisting: boolean;
  serverSentItems: OrderItem[];
  serverDraftItems: OrderItem[];
  onSendOrphanDrafts: () => void;
}) {
  const hasServerDrafts = serverDraftItems.length > 0;
  return (
    <View style={styles.cart}>
      {isExisting && serverSentItems.length > 0 ? (
        <View style={styles.sentBlock}>
          <Text style={styles.sectionLabel}>Already sent</Text>
          {serverSentItems.slice(0, 4).map((i) => (
            <Text key={i.id} style={styles.sentLine} numberOfLines={1}>
              {i.quantity}× {i.menuItemName}
              {i.variationName ? ` (${i.variationName})` : ''}
            </Text>
          ))}
          {serverSentItems.length > 4 ? (
            <Text style={styles.sentLine}>+ {serverSentItems.length - 4} more…</Text>
          ) : null}
        </View>
      ) : null}

      {isExisting && hasServerDrafts ? (
        <View style={styles.draftsBlock}>
          <Text style={styles.draftsLabel}>{serverDraftItems.length} pending drafts</Text>
          <Pressable
            onPress={onSendOrphanDrafts}
            disabled={busy}
            style={({ pressed }) => [
              styles.draftsButton,
              (busy || pressed) && styles.draftsButtonDim,
            ]}
          >
            <Text style={styles.draftsButtonText}>Send pending</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>New items ({lines.length})</Text>
      {lines.length === 0 ? (
        <Text style={styles.cartEmpty}>Tap menu items to add.</Text>
      ) : (
        <View style={{ maxHeight: 160 }}>
          <ScrollView>
            {lines.map((l) => (
              <View key={l.key} style={styles.cartRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.cartRowName} numberOfLines={1}>
                    {l.menuItemName}
                    {l.variationName ? ` · ${l.variationName}` : ''}
                  </Text>
                  {l.addons.length > 0 ? (
                    <Text style={styles.cartRowMeta} numberOfLines={1}>
                      + {l.addons.map((a) => a.name).join(', ')}
                    </Text>
                  ) : null}
                  {l.notes ? (
                    <Text style={styles.cartRowNote} numberOfLines={1}>
                      “{l.notes}”
                    </Text>
                  ) : null}
                  <Text style={styles.cartRowMeta}>
                    {formatPaise(l.unitPricePaise)} × {l.quantity}
                  </Text>
                </View>
                <View style={styles.qtyBtns}>
                  <Pressable onPress={() => onAdjust(l.key, -1)} style={styles.qtyBtn}>
                    <Text style={styles.qtyBtnText}>−</Text>
                  </Pressable>
                  <Text style={styles.qtyVal}>{l.quantity}</Text>
                  <Pressable onPress={() => onAdjust(l.key, 1)} style={styles.qtyBtn}>
                    <Text style={styles.qtyBtnText}>+</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.cartTotalRow}>
        <Text style={styles.cartTotalLabel}>Subtotal</Text>
        <Text style={styles.cartTotalValue}>{formatPaise(cartTotal)}</Text>
      </View>

      <Pressable
        onPress={onSend}
        disabled={busy || !canSend}
        style={({ pressed }) => [
          styles.sendButton,
          (busy || !canSend) && styles.sendButtonDim,
          pressed && canSend && !busy && styles.sendButtonPressed,
        ]}
      >
        <Text style={styles.sendButtonText}>{busy ? 'Sending…' : 'Send to kitchen'}</Text>
      </Pressable>
    </View>
  );
}

// --- Line editor modal -------------------------------------------------------

function LineEditor({
  item,
  onCancel,
  onConfirm,
}: {
  item: Item;
  onCancel: () => void;
  onConfirm: (line: CartLine) => void;
}) {
  const activeVariations = item.variations.filter((v) => v.isActive);
  const [variationId, setVariationId] = useState<string | null>(activeVariations[0]?.id ?? null);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [quantity, setQuantity] = useState(1);

  const variation: Variation | null = useMemo(
    () => activeVariations.find((v) => v.id === variationId) ?? null,
    [activeVariations, variationId],
  );

  const addons = useMemo(
    () => item.addons.filter((a) => selectedAddonIds.includes(a.id)),
    [item.addons, selectedAddonIds],
  );

  const unitPrice =
    item.pricePaise +
    (variation?.priceDeltaPaise ?? 0) +
    addons.reduce((sum, a) => sum + a.pricePaise, 0);

  const toggleAddon = (id: string) => {
    setSelectedAddonIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const onSubmit = () => {
    const trimmedNotes = notes.trim() || null;
    onConfirm({
      key: signatureFor(item.id, variationId, selectedAddonIds, trimmedNotes),
      menuItemId: item.id,
      menuItemName: item.name,
      variationId,
      variationName: variation?.name ?? null,
      addons: addons.map((a) => ({ id: a.id, name: a.name, pricePaise: a.pricePaise })),
      notes: trimmedNotes,
      unitPricePaise: unitPrice,
      quantity,
    });
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.modalBackdropTouch} onPress={onCancel} />
        <View style={styles.modalSheet}>
          <ScrollView>
            <Text style={styles.modalTitle}>{item.name}</Text>
            <Text style={styles.modalSubtitle}>{formatPaise(item.pricePaise)} base</Text>

            {activeVariations.length > 0 ? (
              <View style={styles.modalSection}>
                <Text style={styles.modalLabel}>Variation</Text>
                <View style={styles.variationRow}>
                  {activeVariations.map((v) => {
                    const selected = v.id === variationId;
                    return (
                      <Pressable
                        key={v.id}
                        onPress={() => setVariationId(v.id)}
                        style={[styles.variationChip, selected && styles.variationChipActive]}
                      >
                        <Text
                          style={[
                            styles.variationChipText,
                            selected && styles.variationChipTextActive,
                          ]}
                        >
                          {v.name}
                        </Text>
                        {v.priceDeltaPaise !== 0 ? (
                          <Text
                            style={[
                              styles.variationDelta,
                              selected && styles.variationDeltaActive,
                            ]}
                          >
                            {v.priceDeltaPaise > 0 ? '+' : ''}
                            {formatPaise(v.priceDeltaPaise)}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {item.addons.length > 0 ? (
              <View style={styles.modalSection}>
                <Text style={styles.modalLabel}>Add-ons</Text>
                {item.addons.map((a) => {
                  const checked = selectedAddonIds.includes(a.id);
                  return (
                    <Pressable
                      key={a.id}
                      onPress={() => toggleAddon(a.id)}
                      style={[styles.addonRow, checked && styles.addonRowActive]}
                    >
                      <Text style={styles.addonName}>
                        {checked ? '☑ ' : '☐ '}
                        {a.name}
                      </Text>
                      <Text style={styles.addonPrice}>+{formatPaise(a.pricePaise)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <View style={styles.modalSection}>
              <Text style={styles.modalLabel}>Notes (optional)</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="e.g. no onions"
                placeholderTextColor="#64748b"
                multiline
                maxLength={500}
                style={styles.notesInput}
              />
            </View>

            <View style={styles.modalSection}>
              <Text style={styles.modalLabel}>Quantity</Text>
              <View style={styles.qtyBtns}>
                <Pressable
                  onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                  style={styles.qtyBtn}
                >
                  <Text style={styles.qtyBtnText}>−</Text>
                </Pressable>
                <Text style={[styles.qtyVal, { fontSize: 18 }]}>{quantity}</Text>
                <Pressable
                  onPress={() => setQuantity((q) => Math.min(999, q + 1))}
                  style={styles.qtyBtn}
                >
                  <Text style={styles.qtyBtnText}>+</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.modalTotalRow}>
              <Text style={styles.modalTotalLabel}>Line total</Text>
              <Text style={styles.modalTotalValue}>{formatPaise(unitPrice * quantity)}</Text>
            </View>
          </ScrollView>

          <View style={styles.modalActions}>
            <Pressable onPress={onCancel} style={[styles.modalBtn, styles.modalBtnSecondary]}>
              <Text style={styles.modalBtnSecondaryText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={onSubmit} style={[styles.modalBtn, styles.modalBtnPrimary]}>
              <Text style={styles.modalBtnPrimaryText}>Add to cart</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// --- styles ------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerAction: { color: '#60a5fa', fontSize: 15, fontWeight: '600', paddingHorizontal: 4 },

  // Category strip
  catStrip: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#1e293b',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  catChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  catChipText: { color: '#cbd5e1', fontSize: 13, fontWeight: '500' },
  catChipTextActive: { color: '#fff' },

  // Item grid
  itemGrid: { paddingHorizontal: 12, paddingBottom: 12 },
  itemRow: { justifyContent: 'space-between', marginBottom: 8 },
  itemCard: {
    flex: 1,
    marginHorizontal: 4,
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    minHeight: 80,
  },
  itemCardPressed: { opacity: 0.7 },
  itemCardDisabled: { opacity: 0.4 },
  itemName: { color: '#fff', fontSize: 14, fontWeight: '600' },
  itemPrice: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  itemOptions: { color: '#60a5fa', fontSize: 10, textTransform: 'uppercase', marginTop: 4 },
  itemOut: { color: '#f87171', fontSize: 10, textTransform: 'uppercase', marginTop: 4 },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 20 },

  // Cart
  cart: {
    backgroundColor: '#020617',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 16,
  },
  sectionLabel: {
    color: '#94a3b8',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    fontWeight: '600',
  },
  sentBlock: { marginBottom: 8 },
  sentLine: { color: '#cbd5e1', fontSize: 12 },
  draftsBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#422006',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  draftsLabel: { color: '#fbbf24', fontSize: 12, fontWeight: '600', flex: 1 },
  draftsButton: { backgroundColor: '#b45309', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  draftsButtonDim: { opacity: 0.5 },
  draftsButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  cartEmpty: { color: '#64748b', fontSize: 12, textAlign: 'center', paddingVertical: 10 },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e293b',
  },
  cartRowName: { color: '#fff', fontSize: 13, fontWeight: '500' },
  cartRowMeta: { color: '#94a3b8', fontSize: 11, marginTop: 1 },
  cartRowNote: { color: '#fbbf24', fontSize: 11, fontStyle: 'italic' },
  qtyBtns: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  qtyBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  qtyVal: { color: '#fff', width: 28, textAlign: 'center', fontSize: 14, fontVariant: ['tabular-nums'] },
  cartTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  cartTotalLabel: { color: '#94a3b8', fontSize: 13 },
  cartTotalValue: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sendButton: {
    marginTop: 10,
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  sendButtonPressed: { backgroundColor: '#1d4ed8' },
  sendButtonDim: { opacity: 0.4 },
  sendButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },

  // Modal
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  modalBackdropTouch: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '85%',
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  modalSubtitle: { color: '#94a3b8', fontSize: 13, marginTop: 2 },
  modalSection: { marginTop: 18 },
  modalLabel: {
    color: '#94a3b8',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    fontWeight: '600',
  },
  variationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  variationChip: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  variationChipActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  variationChipText: { color: '#cbd5e1', fontSize: 13, fontWeight: '500' },
  variationChipTextActive: { color: '#fff' },
  variationDelta: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  variationDeltaActive: { color: '#dbeafe' },
  addonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  addonRowActive: { borderColor: '#2563eb' },
  addonName: { color: '#fff', fontSize: 14 },
  addonPrice: { color: '#94a3b8', fontSize: 13 },
  notesInput: {
    backgroundColor: '#1e293b',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  modalTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  modalTotalLabel: { color: '#94a3b8', fontSize: 13 },
  modalTotalValue: { color: '#fff', fontSize: 18, fontWeight: '700' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  modalBtnSecondary: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  modalBtnPrimary: { backgroundColor: '#2563eb' },
  modalBtnSecondaryText: { color: '#cbd5e1', fontSize: 15, fontWeight: '600' },
  modalBtnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
