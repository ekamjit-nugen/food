import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  useAddons,
  useAddonGroups,
  useCategories,
  useCreateItem,
  useDeactivateItem,
  useItems,
  useSetItemInStock,
  useUpdateItem,
  type Addon,
  type AddonGroup,
  type Category,
  type Item,
  type ItemCreateInput,
  type ItemUpdateInput,
  type VariationInput,
} from '../../lib/menu';
import { formatPaise, paiseToAmountString, parseAmountToPaise } from '../../lib/money';
import { ApiError } from '../../lib/auth';

/**
 * Admin items page.
 *
 * Responsibilities:
 *   - List every item (active + inactive) with category, price, stock state.
 *   - In-stock toggle (the hot path during service).
 *   - Full CRUD via a modal form: create, edit, deactivate.
 *
 * Variations and addons are edited inline on the item form — variations as
 * a dynamic list of {name, deltaRupees}, addons as checkboxes sourced from
 * /menu/addons. Addon resource CRUD itself is not yet in the UI; seed addons
 * through the API and pick them here.
 */
export function AdminItems() {
  const items = useItems();
  const categories = useCategories();
  const addons = useAddons();
  const addonGroupsQuery = useAddonGroups();

  const [editing, setEditing] = useState<Item | null>(null);
  const [creating, setCreating] = useState(false);

  const loading = items.isLoading || categories.isLoading || addons.isLoading || addonGroupsQuery.isLoading;
  const error = items.error ?? categories.error ?? addons.error ?? addonGroupsQuery.error;

  return (
    <div>
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Menu items</h2>
        <button
          onClick={() => setCreating(true)}
          disabled={!categories.data || categories.data.filter((c) => c.isActive).length === 0}
          title={
            categories.data && categories.data.filter((c) => c.isActive).length === 0
              ? 'Create a category first'
              : undefined
          }
          className="btn-primary disabled:opacity-60"
        >
          New item
        </button>
      </header>

      {loading && <div className="text-warm-500">Loading…</div>}
      {error && (
        <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
          {(error as Error).message}
        </div>
      )}

      {items.data && categories.data && (
        <ItemTable
          items={items.data}
          categories={categories.data}
          onEdit={setEditing}
        />
      )}

      {creating && categories.data && addons.data && (
        <ItemFormModal
          mode="create"
          categories={categories.data}
          addons={addons.data}
          addonGroups={addonGroupsQuery.data ?? []}
          onClose={() => setCreating(false)}
        />
      )}
      {editing && categories.data && addons.data && (
        <ItemFormModal
          mode="edit"
          item={editing}
          categories={categories.data}
          addons={addons.data}
          addonGroups={addonGroupsQuery.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ItemTable({
  items,
  categories,
  onEdit,
}: {
  items: Item[];
  categories: Category[];
  onEdit: (item: Item) => void;
}) {
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-warm-300 bg-white p-6 text-center text-warm-500">
        No items yet.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-warm-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-warm-50 text-warm-600">
          <tr>
            <th className="text-left font-medium px-4 py-2">Name</th>
            <th className="text-left font-medium px-4 py-2">Category</th>
            <th className="text-right font-medium px-4 py-2">Price</th>
            <th className="text-center font-medium px-4 py-2">Active</th>
            <th className="text-center font-medium px-4 py-2">In stock</th>
            <th className="text-right font-medium px-4 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              category={categoryById.get(item.categoryId) ?? null}
              onEdit={onEdit}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemRow({
  item,
  category,
  onEdit,
}: {
  item: Item;
  category: Category | null;
  onEdit: (item: Item) => void;
}) {
  const stockMutation = useSetItemInStock();
  const deactivate = useDeactivateItem();
  const toggling = stockMutation.isPending;

  return (
    <tr className="border-t border-warm-100">
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span
            className={
              'inline-block w-2.5 h-2.5 rounded-sm border shrink-0 ' +
              (item.foodType === 'veg' ? 'border-green-600 bg-green-600' :
               item.foodType === 'egg' ? 'border-yellow-500 bg-yellow-500' :
               'border-red-600 bg-red-600')
            }
            title={item.foodType}
          />
          <span className="font-medium text-warm-900">{item.name}</span>
          {item.shortCode && (
            <span className="text-xs text-warm-400 font-mono">[{item.shortCode}]</span>
          )}
        </div>
        {item.description && (
          <div className="text-xs text-warm-500 mt-0.5 truncate max-w-sm">{item.description}</div>
        )}
      </td>
      <td className="px-4 py-3 text-warm-700">{category?.name ?? '—'}</td>
      <td className="px-4 py-3 text-right tabular-nums font-mono">{formatPaise(item.pricePaise)}</td>
      <td className="px-4 py-3 text-center">
        {item.isActive ? (
          <span className="text-status-green">yes</span>
        ) : (
          <span className="text-warm-400">no</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        <button
          disabled={toggling || !item.isActive}
          onClick={() => stockMutation.mutate({ itemId: item.id, inStock: !item.inStock })}
          className={
            'inline-flex items-center rounded-full px-3 py-1 text-xs font-medium transition ' +
            (item.inStock
              ? 'bg-status-green-light text-status-green hover:bg-status-green-light'
              : 'bg-status-red-light text-status-red hover:bg-status-red-light') +
            (toggling || !item.isActive ? ' opacity-60 cursor-not-allowed' : '')
          }
        >
          {item.inStock ? 'In stock' : 'Out of stock'}
        </button>
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={() => onEdit(item)}
          className="text-sm font-medium text-warm-700 hover:text-warm-900 mr-3"
        >
          Edit
        </button>
        {item.isActive && (
          <button
            onClick={() => {
              if (confirm(`Deactivate "${item.name}"?`)) deactivate.mutate(item.id);
            }}
            disabled={deactivate.isPending}
            className="text-sm font-medium text-status-red hover:text-status-red disabled:opacity-60"
          >
            Deactivate
          </button>
        )}
      </td>
    </tr>
  );
}

// -- Create/Edit form ------------------------------------------------------

interface VariationDraft {
  id?: string;
  name: string;
  deltaRupees: string; // signed string, e.g. "50" or "-20"
}

function ItemFormModal(
  props:
    | { mode: 'create'; categories: Category[]; addons: Addon[]; addonGroups: AddonGroup[]; onClose: () => void }
    | {
        mode: 'edit';
        item: Item;
        categories: Category[];
        addons: Addon[];
        addonGroups: AddonGroup[];
        onClose: () => void;
      },
) {
  const existing = props.mode === 'edit' ? props.item : null;
  const activeCategories = props.categories.filter((c) => c.isActive || c.id === existing?.categoryId);

  const [categoryId, setCategoryId] = useState<string>(
    existing?.categoryId ?? activeCategories[0]?.id ?? '',
  );
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [priceInput, setPriceInput] = useState(
    existing ? paiseToAmountString(existing.pricePaise) : '',
  );
  const [taxPctInput, setTaxPctInput] = useState(
    existing ? (existing.taxRateBps / 100).toString() : '5',
  );
  const [foodType, setFoodType] = useState(existing?.foodType ?? 'veg');
  const [shortCode, setShortCode] = useState(existing?.shortCode ?? '');
  const [hsnCode, setHsnCode] = useState(existing?.hsnCode ?? '');
  const [packingInput, setPackingInput] = useState(
    existing ? paiseToAmountString(existing.packingChargePaise) : '0',
  );
  const [goodsOrServices, setGoodsOrServices] = useState(existing?.goodsOrServices ?? 'goods');
  const [inStock, setInStock] = useState(existing?.inStock ?? true);
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [variations, setVariations] = useState<VariationDraft[]>(
    existing
      ? existing.variations.map((v) => ({
          id: v.id,
          name: v.name,
          deltaRupees: paiseToAmountString(v.priceDeltaPaise),
        }))
      : [],
  );
  const [addonIds, setAddonIds] = useState<Set<string>>(
    new Set(existing?.addons.map((a) => a.id) ?? []),
  );
  const [addonGroupIdSet, setAddonGroupIdSet] = useState<Set<string>>(
    new Set(existing?.addonGroups.map((g) => g.id) ?? []),
  );
  const [error, setError] = useState<string | null>(null);

  const create = useCreateItem();
  const update = useUpdateItem();
  const pending = create.isPending || update.isPending;

  function addVariation() {
    setVariations((prev) => [...prev, { name: '', deltaRupees: '0' }]);
  }
  function updateVariation(i: number, patch: Partial<VariationDraft>) {
    setVariations((prev) => prev.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  }
  function removeVariation(i: number) {
    setVariations((prev) => prev.filter((_, idx) => idx !== i));
  }
  function toggleAddon(id: string) {
    setAddonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAddonGroup(id: string) {
    setAddonGroupIdSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) return setError('name is required');
    if (!categoryId) return setError('category is required');

    const pricePaise = parseAmountToPaise(priceInput);
    if (pricePaise === null) return setError('price must look like 120 or 99.50');

    const pctNum = Number(taxPctInput);
    if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100) {
      return setError('tax % must be between 0 and 100');
    }
    const taxRateBps = Math.round(pctNum * 100);

    const packingPaise = parseAmountToPaise(packingInput);
    if (packingPaise === null) return setError('packing charge must look like 20 or 15.50');

    // Parse variation deltas (signed rupees) into signed paise. An empty
    // string is treated as 0; a non-parseable entry aborts with an error.
    const parsedVariations: VariationInput[] = [];
    for (let i = 0; i < variations.length; i++) {
      const v = variations[i]!;
      const vn = v.name.trim();
      if (!vn) return setError(`variation ${i + 1}: name required`);
      const signed = v.deltaRupees.trim();
      const isNeg = signed.startsWith('-');
      const abs = isNeg ? signed.slice(1) : signed;
      const absPaise = parseAmountToPaise(abs || '0');
      if (absPaise === null) {
        return setError(`variation ${i + 1}: price delta must look like 20 or -15.50`);
      }
      const entry: VariationInput = {
        name: vn,
        priceDeltaPaise: isNeg ? -absPaise : absPaise,
        displayOrder: i,
      };
      if (v.id) entry.id = v.id;
      parsedVariations.push(entry);
    }

    try {
      const shared = {
        categoryId,
        name: trimmedName,
        description: description.trim() || null,
        pricePaise,
        taxRateBps,
        inStock,
        foodType: foodType as 'veg' | 'non-veg' | 'egg',
        shortCode: shortCode.trim() || null,
        hsnCode: hsnCode.trim() || null,
        packingChargePaise: packingPaise,
        goodsOrServices: goodsOrServices as 'goods' | 'services',
        variations: parsedVariations,
        addonIds: [...addonIds],
        addonGroupIds: [...addonGroupIdSet],
      };
      if (props.mode === 'create') {
        await create.mutateAsync(shared as ItemCreateInput);
      } else {
        await update.mutateAsync({
          id: props.item.id,
          input: { ...shared, isActive } as ItemUpdateInput,
        });
      }
      props.onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'save failed');
    }
  }

  return (
    <ModalShell
      title={props.mode === 'create' ? 'New item' : `Edit ${existing?.name ?? 'item'}`}
      onClose={props.onClose}
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full input-base text-sm"
            >
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {!c.isActive ? ' (inactive)' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full input-base text-sm"
            />
          </Field>
        </div>

        <Field label="Description (optional)">
          <textarea
            value={description ?? ''}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full input-base text-sm"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Price (₹)">
            <input
              type="text"
              inputMode="decimal"
              placeholder="120 or 99.50"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              className="w-full input-base text-sm tabular-nums font-mono"
            />
          </Field>
          <Field label="Tax rate (%)">
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={taxPctInput}
              onChange={(e) => setTaxPctInput(e.target.value)}
              className="w-full input-base text-sm tabular-nums font-mono"
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Food type">
            <select value={foodType} onChange={(e) => setFoodType(e.target.value)} className="w-full input-base text-sm">
              <option value="veg">Veg</option>
              <option value="non-veg">Non-veg</option>
              <option value="egg">Egg</option>
            </select>
          </Field>
          <Field label="Short code">
            <input type="text" maxLength={20} placeholder="e.g. PT" value={shortCode} onChange={(e) => setShortCode(e.target.value)} className="w-full input-base text-sm" />
          </Field>
          <Field label="HSN code">
            <input type="text" maxLength={20} placeholder="e.g. 9963" value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} className="w-full input-base text-sm" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Packing charge (₹)">
            <input
              type="text"
              inputMode="decimal"
              placeholder="20 or 15.50"
              value={packingInput}
              onChange={(e) => setPackingInput(e.target.value)}
              className="w-full input-base text-sm tabular-nums font-mono"
            />
          </Field>
          <Field label="Goods / Services">
            <select value={goodsOrServices} onChange={(e) => setGoodsOrServices(e.target.value)} className="w-full input-base text-sm">
              <option value="goods">Goods</option>
              <option value="services">Services</option>
            </select>
          </Field>
        </div>

        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={inStock}
              onChange={(e) => setInStock(e.target.checked)}
            />
            In stock
          </label>
          {props.mode === 'edit' && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              Active
            </label>
          )}
        </div>

        <section>
          <div className="mb-1 flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wide text-warm-600">
              Variations
            </div>
            <button
              type="button"
              onClick={addVariation}
              className="text-xs font-medium text-warm-700 hover:text-warm-900"
            >
              + add
            </button>
          </div>
          {variations.length === 0 ? (
            <div className="text-xs text-warm-400">No variations.</div>
          ) : (
            <div className="space-y-2">
              {variations.map((v, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Name (e.g. Half)"
                    value={v.name}
                    onChange={(e) => updateVariation(i, { name: e.target.value })}
                    className="flex-1 input-base text-sm"
                  />
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="Δ ₹ (signed)"
                    value={v.deltaRupees}
                    onChange={(e) => updateVariation(i, { deltaRupees: e.target.value })}
                    className="w-32 input-base text-sm tabular-nums font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => removeVariation(i)}
                    className="text-sm text-status-red hover:text-status-red"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-warm-600">
            Add-ons
          </div>
          {props.addons.length === 0 ? (
            <div className="text-xs text-warm-400">
              No add-ons yet. <a href="/admin/addons" className="text-brand hover:underline">Create addons</a> first.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1 max-h-40 overflow-auto rounded-md border border-warm-200 p-2">
              {props.addons
                .filter((a) => a.isActive || addonIds.has(a.id))
                .map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={addonIds.has(a.id)}
                      onChange={() => toggleAddon(a.id)}
                    />
                    <span>
                      {a.name}{' '}
                      <span className="text-warm-400 tabular-nums font-mono">
                        {formatPaise(a.pricePaise)}
                      </span>
                    </span>
                  </label>
                ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-warm-600">
            Addon groups
          </div>
          {props.addonGroups.length === 0 ? (
            <div className="text-xs text-warm-400">
              No addon groups yet. <a href="/admin/addons" className="text-brand hover:underline">Create groups</a> first.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-1 max-h-40 overflow-auto rounded-md border border-warm-200 p-2">
              {props.addonGroups
                .filter((g) => g.isActive || addonGroupIdSet.has(g.id))
                .map((g) => (
                  <label key={g.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={addonGroupIdSet.has(g.id)}
                      onChange={() => toggleAddonGroup(g.id)}
                    />
                    <span>
                      {g.name}{' '}
                      <span className="text-warm-400">
                        ({g.selectionType}, {g.addons.length} addons)
                      </span>
                    </span>
                  </label>
                ))}
            </div>
          )}
        </section>

        {error && (
          <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={props.onClose}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="btn-primary disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-warm-200 px-4 py-3">
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <div className="p-4 max-h-[80vh] overflow-auto">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-warm-600">
        {label}
      </div>
      {children}
    </label>
  );
}
