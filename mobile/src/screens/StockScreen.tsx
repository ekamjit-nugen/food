import React, { useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError } from '../lib/api';
import { useMenuItems, useSetItemInStock, type Item } from '../lib/menu';
import { formatPaise } from '../lib/money';
import type { StockProps } from '../lib/navigation';

/**
 * 86-item toggle screen ("86" is restaurant slang for "we're out of that").
 *
 * Lists every active menu item with a switch that flips its in_stock flag.
 * Optimistic update through useSetItemInStock, rolls back on server error.
 * A search box at the top narrows by name — vital on a menu with 80+ items
 * when the cook calls out "we're out of paneer" during a rush.
 *
 * Inactive items are filtered out client-side; they cannot be ordered
 * anyway, so surfacing them would be noise.
 */
export function StockScreen({ navigation }: StockProps) {
  const query = useMenuItems();
  const setInStock = useSetItemInStock();
  const [filter, setFilter] = useState('');

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Stock · 86 items' });
  }, [navigation]);

  const items = useMemo(() => {
    const src = (query.data ?? []).filter((i) => i.isActive);
    const f = filter.trim().toLowerCase();
    if (!f) return src;
    return src.filter((i) => i.name.toLowerCase().includes(f));
  }, [query.data, filter]);

  const onToggle = async (item: Item, next: boolean) => {
    try {
      await setInStock.mutateAsync({ itemId: item.id, inStock: next });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to update stock';
      Alert.alert('Update failed', msg);
    }
  };

  if (query.isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.searchRow}>
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="Search items…"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.search}
        />
        {filter.length > 0 ? (
          <Pressable onPress={() => setFilter('')} hitSlop={8} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {query.error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{(query.error as Error).message}</Text>
        </View>
      ) : null}

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <StockRow item={item} onToggle={(v) => void onToggle(item, v)} />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {filter ? 'No items match.' : 'No menu items yet.'}
          </Text>
        }
      />
    </View>
  );
}

function StockRow({ item, onToggle }: { item: Item; onToggle: (next: boolean) => void }) {
  return (
    <View style={[styles.row, !item.inStock && styles.rowOut]}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.itemMeta}>{formatPaise(item.pricePaise)}</Text>
        {!item.inStock ? <Text style={styles.outBadge}>86'd</Text> : null}
      </View>
      <Switch
        value={item.inStock}
        onValueChange={onToggle}
        trackColor={{ false: '#7f1d1d', true: '#065f46' }}
        thumbColor={item.inStock ? '#34d399' : '#f87171'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  search: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#334155',
  },
  clearBtn: { marginLeft: 10, paddingHorizontal: 6 },
  clearBtnText: { color: '#60a5fa', fontSize: 13, fontWeight: '600' },
  errorBox: { marginHorizontal: 16, backgroundColor: '#7f1d1d', padding: 10, borderRadius: 8 },
  errorText: { color: '#fecaca', fontSize: 13 },
  list: { padding: 16, paddingTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  rowOut: { borderColor: '#7f1d1d', backgroundColor: '#1a1010' },
  itemName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  itemMeta: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  outBadge: {
    color: '#fca5a5',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 40 },
});
