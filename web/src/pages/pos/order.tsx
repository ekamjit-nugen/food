import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Shell } from '../shell';
import { useServiceMenu, type AddonGroup, type Item, type ServiceMenuCategory, type Variation } from '../../lib/menu';
import {
  useAddOrderItems,
  useCreateOrder,
  useOrderDetail,
  useSendDraftItems,
  type DraftOrderItemInput,
  type OrderItem,
} from '../../lib/orders';
import { formatPaise } from '../../lib/money';
import { ApiError } from '../../lib/auth';

interface CartLine {
  key: string;
  menuItemId: string;
  menuItemName: string;
  variationId: string | null;
  variationName: string | null;
  variationDeltaPaise: number;
  addons: Array<{ id: string; name: string; pricePaise: number }>;
  notes: string | null;
  basePricePaise: number;
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

export function PosOrderScreen({ mode }: { mode: 'new' | 'existing' }) {
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const existingOrderId = mode === 'existing' ? (params.id ?? null) : null;
  const tableIdFromQuery = searchParams.get('tableId');
  const orderTypeFromQuery = searchParams.get('type') === 'takeaway' ? 'takeaway' as const : 'dine_in' as const;

  const orderQuery = useOrderDetail(existingOrderId);
  const menuQuery = useServiceMenu();

  const createOrder = useCreateOrder();
  const addItems = useAddOrderItems();
  const sendDrafts = useSendDraftItems();

  const [lines, setLines] = useState<CartLine[]>([]);
  const [editorItem, setEditorItem] = useState<Item | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  function upsertLine(line: CartLine) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.key === line.key);
      if (idx === -1) return [...prev, line];
      const merged = { ...prev[idx]!, quantity: prev[idx]!.quantity + line.quantity };
      const next = [...prev];
      next[idx] = merged;
      return next;
    });
  }

  function adjustLineQty(key: string, delta: number) {
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
  }

  function onPickItem(item: Item) {
    const hasOptions = item.variations.length > 0 || item.addons.length > 0 || item.addonGroups.length > 0;
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
      variationDeltaPaise: 0,
      addons: [],
      notes: null,
      basePricePaise: item.pricePaise,
      unitPricePaise: item.pricePaise,
      quantity: 1,
    });
  }

  const cartTotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.unitPricePaise * l.quantity, 0),
    [lines],
  );

  const draftItems: DraftOrderItemInput[] = useMemo(
    () =>
      lines.map((l) => {
        const item: DraftOrderItemInput = { menuItemId: l.menuItemId, quantity: l.quantity };
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

  async function onSend() {
    setError(null);
    try {
      if (mode === 'new') {
        if (orderTypeFromQuery === 'dine_in' && !tableIdFromQuery) { setError('missing tableId'); return; }
        if (draftItems.length === 0) { setError('add at least one item'); return; }
        const created = await createOrder.mutateAsync({
          orderType: orderTypeFromQuery,
          ...(orderTypeFromQuery === 'dine_in' && tableIdFromQuery ? { tableId: tableIdFromQuery } : {}),
          ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
          ...(customerPhone.trim() ? { customerPhone: customerPhone.trim() } : {}),
          items: draftItems,
        });
        await sendDrafts.mutateAsync(created.id);
        setLines([]);
        navigate(`/pos/order/${created.id}`, { replace: true });
      } else {
        if (!existingOrderId) return;
        if (draftItems.length === 0 && serverDraftItems.length === 0) return;
        if (draftItems.length > 0) {
          await addItems.mutateAsync({ orderId: existingOrderId, items: draftItems });
          setLines([]);
        }
        await sendDrafts.mutateAsync(existingOrderId);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'send failed');
    }
  }

  async function onSendOrphanDrafts() {
    if (!existingOrderId) return;
    setError(null);
    try {
      await sendDrafts.mutateAsync(existingOrderId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'send failed');
    }
  }

  const busy = createOrder.isPending || addItems.isPending || sendDrafts.isPending;
  const isTakeaway = mode === 'new' ? orderTypeFromQuery === 'takeaway' : orderQuery.data?.orderType === 'takeaway';
  const shellTitle =
    mode === 'new'
      ? isTakeaway ? 'New takeaway order' : 'New order'
      : `Order #${orderQuery.data?.orderNumber ?? '…'}${isTakeaway ? ' (Takeaway)' : ''}`;

  return (
    <Shell title={shellTitle}>
      {/* Header bar */}
      <div className="mb-4 flex items-center justify-between">
        <Link to="/pos" className="text-sm text-warm-600 hover:text-warm-900 transition-colors">
          ← Tables
        </Link>
        {mode === 'existing' && existingOrderId && (
          <Link to={`/pos/order/${existingOrderId}/bill`} className="btn-secondary text-sm px-3 py-1.5">
            Bill
          </Link>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
          {error}
        </div>
      )}

      {/* Takeaway customer fields */}
      {isTakeaway && mode === 'new' && (
        <div className="mb-4 flex items-center gap-3">
          <label className="flex-1">
            <span className="text-xs font-medium text-warm-700">Customer (optional)</span>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              maxLength={120}
              placeholder="e.g. Raj"
              className="input-base mt-1 h-9 text-sm"
            />
          </label>
          <label className="flex-1">
            <span className="text-xs font-medium text-warm-700">Phone (optional)</span>
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              maxLength={32}
              placeholder="e.g. 9876543210"
              className="input-base mt-1 h-9 text-sm"
            />
          </label>
        </div>
      )}

      {/* 2-column layout: Menu | Cart */}
      <div className="grid grid-cols-[1fr,320px] gap-4">
        <div>
          {menuQuery.isLoading && <p className="text-warm-500">Loading menu…</p>}
          {menuQuery.data && <MenuPicker menu={menuQuery.data} onPick={onPickItem} />}
        </div>

        <aside className="sticky top-4 self-start">
          <CartPanel
            lines={lines}
            cartTotal={cartTotal}
            onAdjust={adjustLineQty}
            onSend={onSend}
            onSendOrphanDrafts={onSendOrphanDrafts}
            busy={busy}
            isExisting={mode === 'existing'}
            serverSentItems={serverSentItems}
            serverDraftItems={serverDraftItems}
          />
        </aside>
      </div>

      {editorItem && (
        <LineEditor
          item={editorItem}
          onCancel={() => setEditorItem(null)}
          onConfirm={(line) => { upsertLine(line); setEditorItem(null); }}
        />
      )}
    </Shell>
  );
}

// ── Menu Picker ─────────────────────────────────────────────────────────

const FOOD_TYPE_COLORS: Record<string, string> = {
  veg: 'border-green-600 bg-green-600',
  'non-veg': 'border-red-600 bg-red-600',
  egg: 'border-yellow-500 bg-yellow-500',
};

function MenuPicker({ menu, onPick }: { menu: ServiceMenuCategory[]; onPick: (item: Item) => void }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  if (menu.length === 0) return <p className="text-warm-500">No menu items.</p>;
  const active = menu.find((c) => c.id === activeId) ?? menu[0]!;

  const needle = search.trim().toLowerCase();
  const filteredItems = needle
    ? active.items.filter(
        (item) =>
          item.name.toLowerCase().includes(needle) ||
          (item.shortCode && item.shortCode.toLowerCase().includes(needle)),
      )
    : active.items;

  return (
    <div className="space-y-4">
      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or code…"
        className="input-base h-9 text-sm w-full"
      />

      {/* Horizontal category tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {menu.map((cat) => {
          const selected = cat.id === active.id;
          return (
            <button
              key={cat.id}
              onClick={() => { setActiveId(cat.id); setSearch(''); }}
              className={
                'shrink-0 rounded-sm px-4 py-2 text-sm font-medium transition-all ' +
                (selected
                  ? 'bg-warm-900 text-white'
                  : 'bg-surface-white border border-warm-300 text-warm-700 hover:bg-warm-100')
              }
            >
              {cat.name}
            </button>
          );
        })}
      </div>

      {/* Item grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
        {filteredItems.map((item) => {
          const hasOptions = item.variations.length > 0 || item.addons.length > 0 || item.addonGroups.length > 0;
          return (
            <button
              key={item.id}
              disabled={!item.inStock}
              onClick={() => onPick(item)}
              className={
                'rounded-md border bg-surface-white p-3 text-left transition-all active:scale-[0.98] ' +
                (item.inStock
                  ? 'border-warm-200 hover:border-warm-400 hover:shadow-sm'
                  : 'border-warm-200 opacity-40 cursor-not-allowed')
              }
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={'inline-block w-3 h-3 rounded-sm border ' + (FOOD_TYPE_COLORS[item.foodType] ?? FOOD_TYPE_COLORS.veg)}
                  title={item.foodType}
                />
                <div className="font-medium text-sm text-warm-900 line-clamp-2">{item.name}</div>
              </div>
              <div className="text-sm font-mono text-warm-600 mt-1">{formatPaise(item.pricePaise)}</div>
              {hasOptions && (
                <span className="badge-amber text-[10px] mt-1.5">OPTIONS</span>
              )}
              {!item.inStock && (
                <span className="badge-red text-[10px] mt-1.5">Out of stock</span>
              )}
            </button>
          );
        })}
        {filteredItems.length === 0 && (
          <p className="col-span-full text-sm text-warm-400 text-center py-6">No items match "{search}"</p>
        )}
      </div>
    </div>
  );
}

// ── Line Editor Modal ───────────────────────────────────────────────────

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
  const [groupSelections, setGroupSelections] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const g of item.addonGroups) init[g.id] = [];
    return init;
  });
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

  const groupAddonTotal = useMemo(() => {
    let total = 0;
    for (const g of item.addonGroups) {
      const ids = groupSelections[g.id] ?? [];
      for (const a of g.addons) {
        if (ids.includes(a.id)) total += a.pricePaise;
      }
    }
    return total;
  }, [item.addonGroups, groupSelections]);

  const unitPrice =
    item.pricePaise + (variation?.priceDeltaPaise ?? 0) + addons.reduce((sum, a) => sum + a.pricePaise, 0) + groupAddonTotal;

  function toggleAddon(id: string) {
    setSelectedAddonIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function toggleGroupAddon(group: AddonGroup, addonId: string) {
    setGroupSelections((prev) => {
      const cur = prev[group.id] ?? [];
      if (group.selectionType === 'single') {
        return { ...prev, [group.id]: cur.includes(addonId) ? [] : [addonId] };
      }
      const maxOk = group.maxSelections === 0 || cur.length < group.maxSelections;
      if (cur.includes(addonId)) {
        return { ...prev, [group.id]: cur.filter((x) => x !== addonId) };
      }
      if (!maxOk) return prev;
      return { ...prev, [group.id]: [...cur, addonId] };
    });
  }

  const [validationError, setValidationError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Validate addon group min selections
    for (const g of item.addonGroups) {
      const count = (groupSelections[g.id] ?? []).length;
      if (g.minSelections > 0 && count < g.minSelections) {
        setValidationError(`${g.name}: select at least ${g.minSelections}`);
        return;
      }
    }
    setValidationError(null);
    const trimmedNotes = notes.trim() || null;
    // Merge ungrouped + grouped addon ids for the cart line
    const allGroupAddonIds = Object.values(groupSelections).flat();
    const allAddonIds = [...selectedAddonIds, ...allGroupAddonIds];
    const allAddons = [
      ...addons.map((a) => ({ id: a.id, name: a.name, pricePaise: a.pricePaise })),
      ...item.addonGroups.flatMap((g) =>
        g.addons
          .filter((a) => (groupSelections[g.id] ?? []).includes(a.id))
          .map((a) => ({ id: a.id, name: a.name, pricePaise: a.pricePaise })),
      ),
    ];
    onConfirm({
      key: signatureFor(item.id, variationId, allAddonIds, trimmedNotes),
      menuItemId: item.id,
      menuItemName: item.name,
      variationId,
      variationName: variation?.name ?? null,
      variationDeltaPaise: variation?.priceDeltaPaise ?? 0,
      addons: allAddons,
      notes: trimmedNotes,
      basePricePaise: item.pricePaise,
      unitPricePaise: unitPrice,
      quantity,
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-warm-950/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-surface-white shadow-xl border border-warm-200 p-6 space-y-5"
      >
        <div>
          <h2 className="text-lg font-semibold text-warm-900">{item.name}</h2>
          <p className="text-sm font-mono text-warm-500">{formatPaise(item.pricePaise)} base</p>
        </div>

        {activeVariations.length > 0 && (
          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-warm-500 mb-2">Variation</h3>
            <div className="flex flex-wrap gap-2">
              {activeVariations.map((v) => {
                const selected = v.id === variationId;
                return (
                  <button
                    type="button"
                    key={v.id}
                    onClick={() => setVariationId(v.id)}
                    className={
                      'rounded-sm px-4 py-2 text-sm font-medium transition-all ' +
                      (selected
                        ? 'bg-warm-900 text-white'
                        : 'bg-surface-white border border-warm-300 text-warm-700 hover:bg-warm-100')
                    }
                  >
                    {v.name}
                    {v.priceDeltaPaise !== 0 && (
                      <span className={selected ? 'text-warm-400 ml-1' : 'text-warm-500 ml-1'}>
                        {v.priceDeltaPaise > 0 ? '+' : ''}{formatPaise(v.priceDeltaPaise)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {item.addons.length > 0 && (
          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-warm-500 mb-2">Add-ons</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {item.addons.map((a) => {
                const checked = selectedAddonIds.includes(a.id);
                return (
                  <label
                    key={a.id}
                    className={
                      'flex items-center justify-between gap-2 rounded-sm border px-3 py-2.5 cursor-pointer transition-all ' +
                      (checked ? 'border-brand bg-brand-light' : 'border-warm-200 hover:bg-warm-50')
                    }
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAddon(a.id)}
                        className="h-4 w-4 rounded border-warm-300 text-brand focus:ring-brand-ring"
                      />
                      <span className="text-sm text-warm-800">{a.name}</span>
                    </span>
                    <span className="text-sm font-mono text-warm-500">+{formatPaise(a.pricePaise)}</span>
                  </label>
                );
              })}
            </div>
          </section>
        )}

        {item.addonGroups.map((g) => {
          const selected = groupSelections[g.id] ?? [];
          const constraint =
            g.minSelections > 0 && g.maxSelections > 0 ? `Select ${g.minSelections}-${g.maxSelections}`
            : g.minSelections > 0 ? `Select at least ${g.minSelections}`
            : g.maxSelections > 0 ? `Select up to ${g.maxSelections}`
            : null;
          return (
            <section key={g.id}>
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-xs font-medium uppercase tracking-wide text-warm-500">{g.name}</h3>
                {constraint && <span className="text-[10px] text-warm-400">{constraint}</span>}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {g.addons.map((a) => {
                  const checked = selected.includes(a.id);
                  const inputType = g.selectionType === 'single' ? 'radio' : 'checkbox';
                  return (
                    <label
                      key={a.id}
                      className={
                        'flex items-center justify-between gap-2 rounded-sm border px-3 py-2.5 cursor-pointer transition-all ' +
                        (checked ? 'border-brand bg-brand-light' : 'border-warm-200 hover:bg-warm-50')
                      }
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type={inputType}
                          name={`addon-group-${g.id}`}
                          checked={checked}
                          onChange={() => toggleGroupAddon(g, a.id)}
                          className="h-4 w-4 rounded border-warm-300 text-brand focus:ring-brand-ring"
                        />
                        <span className="text-sm text-warm-800">{a.name}</span>
                      </span>
                      {a.pricePaise > 0 && (
                        <span className="text-sm font-mono text-warm-500">+{formatPaise(a.pricePaise)}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}

        {validationError && (
          <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
            {validationError}
          </div>
        )}

        <section>
          <h3 className="text-xs font-medium uppercase tracking-wide text-warm-500 mb-2">Notes (optional)</h3>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. no onions"
            className="input-base h-auto py-2"
          />
        </section>

        <section className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-warm-500">Quantity</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="w-10 h-10 rounded-sm border border-warm-300 text-warm-700 hover:bg-warm-100 active:scale-[0.95] transition-all text-lg"
            >
              −
            </button>
            <div className="w-10 text-center font-mono text-xl font-bold">{quantity}</div>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(999, q + 1))}
              className="w-10 h-10 rounded-sm border border-warm-300 text-warm-700 hover:bg-warm-100 active:scale-[0.95] transition-all text-lg"
            >
              +
            </button>
          </div>
        </section>

        <div className="flex items-baseline justify-between border-t border-warm-200 pt-4">
          <span className="text-sm text-warm-600">Line total</span>
          <span className="text-lg font-bold font-mono">{formatPaise(unitPrice * quantity)}</span>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost flex-1 py-2.5">Cancel</button>
          <button type="submit" className="btn-primary flex-1 py-2.5">Add to cart</button>
        </div>
      </form>
    </div>
  );
}

// ── Cart Panel ──────────────────────────────────────────────────────────

function CartPanel({
  lines,
  cartTotal,
  onAdjust,
  onSend,
  onSendOrphanDrafts,
  busy,
  isExisting,
  serverSentItems,
  serverDraftItems,
}: {
  lines: CartLine[];
  cartTotal: number;
  onAdjust: (key: string, delta: number) => void;
  onSend: () => void;
  onSendOrphanDrafts: () => void;
  busy: boolean;
  isExisting: boolean;
  serverSentItems: OrderItem[];
  serverDraftItems: OrderItem[];
}) {
  const hasServerDrafts = serverDraftItems.length > 0;
  const canSend = lines.length > 0 || (isExisting && hasServerDrafts);

  return (
    <div className="rounded-md border border-warm-200 bg-surface-white p-4 space-y-4">
      {/* Already sent */}
      {isExisting && (
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wide text-warm-500 mb-2">Already sent</h3>
          <SentItems items={serverSentItems} />
        </section>
      )}

      {/* Pending server drafts */}
      {isExisting && hasServerDrafts && (
        <section className="rounded-sm border-l-[3px] border-l-status-amber bg-status-amber-light p-3">
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-status-amber">Pending drafts</h3>
            <span className="text-[10px] text-status-amber">not yet sent</span>
          </div>
          <SentItems items={serverDraftItems} />
          <button
            onClick={onSendOrphanDrafts}
            disabled={busy}
            className="mt-2 w-full btn-primary py-1.5 text-sm"
          >
            {busy ? 'Sending…' : 'Send pending'}
          </button>
        </section>
      )}

      {/* New items (local cart) */}
      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-warm-500 mb-2">New items</h3>
        {lines.length === 0 ? (
          <p className="text-sm text-warm-400 italic py-3 text-center">Tap menu items to add.</p>
        ) : (
          <ul className="divide-y divide-warm-100">
            {lines.map((l) => (
              <li key={l.key} className="py-2.5 flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-warm-900 truncate">
                    {l.menuItemName}
                    {l.variationName && <span className="text-warm-500"> ({l.variationName})</span>}
                  </div>
                  {l.addons.length > 0 && (
                    <div className="text-xs text-warm-500 truncate">+{l.addons.map((a) => a.name).join(', ')}</div>
                  )}
                  {l.notes && <div className="text-xs italic text-status-amber truncate">{l.notes}</div>}
                  <div className="text-sm font-mono text-warm-900 mt-0.5">{formatPaise(l.unitPricePaise * l.quantity)}</div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onAdjust(l.key, -1)}
                    className="w-7 h-7 rounded-sm border border-warm-300 text-warm-700 hover:bg-warm-100 active:scale-[0.95] transition-all"
                  >
                    −
                  </button>
                  <div className="w-6 text-center text-sm font-mono tabular-nums">{l.quantity}</div>
                  <button
                    onClick={() => onAdjust(l.key, 1)}
                    className="w-7 h-7 rounded-sm border border-warm-300 text-warm-700 hover:bg-warm-100 active:scale-[0.95] transition-all"
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Subtotal */}
      <div className="flex items-baseline justify-between border-t border-warm-200 pt-3">
        <span className="text-sm text-warm-600">New items</span>
        <span className="font-semibold font-mono">{formatPaise(cartTotal)}</span>
      </div>

      {/* Send button */}
      <button
        onClick={onSend}
        disabled={busy || !canSend}
        className="w-full btn-primary h-12 text-base"
      >
        {busy ? 'Sending…' : 'Send to kitchen'}
      </button>
    </div>
  );
}

function SentItems({ items }: { items: OrderItem[] }) {
  if (items.length === 0) return <p className="text-sm text-warm-400">Nothing sent yet.</p>;
  return (
    <ul className="divide-y divide-warm-100">
      {items.map((i) => (
        <li key={i.id} className="py-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-sm text-warm-600 truncate">
              {i.menuItemName}{i.variationName ? ` (${i.variationName})` : ''}
            </div>
            <div className="text-xs font-mono text-warm-500 tabular-nums whitespace-nowrap">
              {formatPaise(i.unitPricePaise)} × {i.quantity}
            </div>
          </div>
          {i.addons.length > 0 && (
            <div className="text-xs text-warm-500 truncate">+{i.addons.map((a) => a.name).join(', ')}</div>
          )}
          {i.notes && <div className="text-xs italic text-status-amber truncate">{i.notes}</div>}
        </li>
      ))}
    </ul>
  );
}
