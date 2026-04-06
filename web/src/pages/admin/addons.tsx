import { useState, type FormEvent, type ReactNode } from 'react';
import {
  useAddons,
  useAddonGroups,
  useCreateAddon,
  useCreateAddonGroup,
  useDeactivateAddon,
  useDeactivateAddonGroup,
  useUpdateAddon,
  useUpdateAddonGroup,
  type Addon,
  type AddonGroup,
} from '../../lib/menu';
import { formatPaise, paiseToAmountString, parseAmountToPaise } from '../../lib/money';
import { ApiError } from '../../lib/auth';

export function AdminAddons() {
  const addons = useAddons();
  const groups = useAddonGroups();

  const [editingAddon, setEditingAddon] = useState<Addon | null>(null);
  const [creatingAddon, setCreatingAddon] = useState(false);
  const [editingGroup, setEditingGroup] = useState<AddonGroup | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);

  const loading = addons.isLoading || groups.isLoading;
  const error = addons.error ?? groups.error;

  return (
    <div className="space-y-8">
      {loading && <div className="text-warm-500">Loading…</div>}
      {error && (
        <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
          {(error as Error).message}
        </div>
      )}

      {/* Addon Groups */}
      <section>
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Addon groups</h2>
          <button onClick={() => setCreatingGroup(true)} className="btn-primary">
            New group
          </button>
        </header>
        {groups.data && <AddonGroupTable rows={groups.data} onEdit={setEditingGroup} />}
      </section>

      {/* Individual Addons */}
      <section>
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Addons</h2>
          <button onClick={() => setCreatingAddon(true)} className="btn-primary">
            New addon
          </button>
        </header>
        {addons.data && groups.data && (
          <AddonTable rows={addons.data} groups={groups.data} onEdit={setEditingAddon} />
        )}
      </section>

      {/* Modals */}
      {creatingAddon && <AddonFormModal mode="create" onClose={() => setCreatingAddon(false)} />}
      {editingAddon && (
        <AddonFormModal mode="edit" addon={editingAddon} onClose={() => setEditingAddon(null)} />
      )}
      {creatingGroup && addons.data && (
        <AddonGroupFormModal mode="create" allAddons={addons.data} onClose={() => setCreatingGroup(false)} />
      )}
      {editingGroup && addons.data && (
        <AddonGroupFormModal
          mode="edit"
          group={editingGroup}
          allAddons={addons.data}
          onClose={() => setEditingGroup(null)}
        />
      )}
    </div>
  );
}

// ── Addon Group Table ────────────────────────────────────────────────────

function AddonGroupTable({ rows, onEdit }: { rows: AddonGroup[]; onEdit: (g: AddonGroup) => void }) {
  const deactivate = useDeactivateAddonGroup();
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-warm-300 bg-white p-6 text-center text-warm-500">
        No addon groups yet.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-warm-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-warm-50 text-warm-600">
          <tr>
            <th className="text-left font-medium px-4 py-2">Name</th>
            <th className="text-left font-medium px-4 py-2">Type</th>
            <th className="text-center font-medium px-4 py-2">Min</th>
            <th className="text-center font-medium px-4 py-2">Max</th>
            <th className="text-center font-medium px-4 py-2">Addons</th>
            <th className="text-center font-medium px-4 py-2">Active</th>
            <th className="text-right font-medium px-4 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.id} className="border-t border-warm-100">
              <td className="px-4 py-3 font-medium text-warm-900">{g.name}</td>
              <td className="px-4 py-3 text-warm-700 capitalize">{g.selectionType}</td>
              <td className="px-4 py-3 text-center tabular-nums">{g.minSelections}</td>
              <td className="px-4 py-3 text-center tabular-nums">{g.maxSelections === 0 ? '∞' : g.maxSelections}</td>
              <td className="px-4 py-3 text-center tabular-nums">{g.addons.length}</td>
              <td className="px-4 py-3 text-center">
                {g.isActive ? <span className="text-status-green">yes</span> : <span className="text-warm-400">no</span>}
              </td>
              <td className="px-4 py-3 text-right">
                <button onClick={() => onEdit(g)} className="text-sm font-medium text-warm-700 hover:text-warm-900 mr-3">
                  Edit
                </button>
                {g.isActive && (
                  <button
                    onClick={() => { if (confirm(`Deactivate "${g.name}"?`)) deactivate.mutate(g.id); }}
                    disabled={deactivate.isPending}
                    className="text-sm font-medium text-status-red hover:text-status-red disabled:opacity-60"
                  >
                    Deactivate
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Addon Table ──────────────────────────────────────────────────────────

function AddonTable({
  rows,
  groups,
  onEdit,
}: {
  rows: Addon[];
  groups: AddonGroup[];
  onEdit: (a: Addon) => void;
}) {
  const deactivate = useDeactivateAddon();

  // Build a lookup: addon id → group name
  const addonGroupMap = new Map<string, string>();
  for (const g of groups) {
    for (const a of g.addons) {
      addonGroupMap.set(a.id, g.name);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-warm-300 bg-white p-6 text-center text-warm-500">
        No addons yet.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-warm-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-warm-50 text-warm-600">
          <tr>
            <th className="text-left font-medium px-4 py-2">Name</th>
            <th className="text-right font-medium px-4 py-2">Price</th>
            <th className="text-left font-medium px-4 py-2">Group</th>
            <th className="text-center font-medium px-4 py-2">Active</th>
            <th className="text-right font-medium px-4 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id} className="border-t border-warm-100">
              <td className="px-4 py-3 font-medium text-warm-900">{a.name}</td>
              <td className="px-4 py-3 text-right tabular-nums font-mono">{formatPaise(a.pricePaise)}</td>
              <td className="px-4 py-3 text-warm-600">{addonGroupMap.get(a.id) ?? '—'}</td>
              <td className="px-4 py-3 text-center">
                {a.isActive ? <span className="text-status-green">yes</span> : <span className="text-warm-400">no</span>}
              </td>
              <td className="px-4 py-3 text-right">
                <button onClick={() => onEdit(a)} className="text-sm font-medium text-warm-700 hover:text-warm-900 mr-3">
                  Edit
                </button>
                {a.isActive && (
                  <button
                    onClick={() => { if (confirm(`Deactivate "${a.name}"?`)) deactivate.mutate(a.id); }}
                    disabled={deactivate.isPending}
                    className="text-sm font-medium text-status-red hover:text-status-red disabled:opacity-60"
                  >
                    Deactivate
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Addon Form Modal ─────────────────────────────────────────────────────

function AddonFormModal(
  props:
    | { mode: 'create'; onClose: () => void }
    | { mode: 'edit'; addon: Addon; onClose: () => void },
) {
  const existing = props.mode === 'edit' ? props.addon : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [priceInput, setPriceInput] = useState(
    existing ? paiseToAmountString(existing.pricePaise) : '0',
  );
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateAddon();
  const update = useUpdateAddon();
  const pending = create.isPending || update.isPending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) return setError('name is required');
    const pricePaise = parseAmountToPaise(priceInput);
    if (pricePaise === null) return setError('price must look like 30 or 15.50');

    try {
      if (props.mode === 'create') {
        await create.mutateAsync({ name: trimmedName, pricePaise });
      } else {
        await update.mutateAsync({
          id: props.addon.id,
          input: { name: trimmedName, pricePaise, isActive },
        });
      }
      props.onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'save failed');
    }
  }

  return (
    <ModalShell title={props.mode === 'create' ? 'New addon' : `Edit ${existing?.name ?? 'addon'}`} onClose={props.onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Name">
          <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} className="w-full input-base text-sm" />
        </Field>
        <Field label="Price (₹)">
          <input
            type="text"
            inputMode="decimal"
            placeholder="30 or 15.50"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            className="w-full input-base text-sm tabular-nums font-mono"
          />
        </Field>
        {props.mode === 'edit' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        )}
        {error && (
          <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">{error}</div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={props.onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Addon Group Form Modal ───────────────────────────────────────────────

function AddonGroupFormModal(
  props:
    | { mode: 'create'; allAddons: Addon[]; onClose: () => void }
    | { mode: 'edit'; group: AddonGroup; allAddons: Addon[]; onClose: () => void },
) {
  const existing = props.mode === 'edit' ? props.group : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [selectionType, setSelectionType] = useState(existing?.selectionType ?? 'multi');
  const [minSelections, setMinSelections] = useState(String(existing?.minSelections ?? 0));
  const [maxSelections, setMaxSelections] = useState(String(existing?.maxSelections ?? 0));
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [addonIds, setAddonIds] = useState<Set<string>>(
    new Set(existing?.addons.map((a) => a.id) ?? []),
  );
  const [error, setError] = useState<string | null>(null);

  const create = useCreateAddonGroup();
  const update = useUpdateAddonGroup();
  const pending = create.isPending || update.isPending;

  function toggleAddon(id: string) {
    setAddonIds((prev) => {
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
    const min = Number(minSelections);
    const max = Number(maxSelections);
    if (!Number.isInteger(min) || min < 0) return setError('min must be a non-negative integer');
    if (!Number.isInteger(max) || max < 0) return setError('max must be a non-negative integer');

    try {
      if (props.mode === 'create') {
        await create.mutateAsync({
          name: trimmedName,
          selectionType: selectionType as 'single' | 'multi',
          minSelections: min,
          maxSelections: max,
          addonIds: [...addonIds],
        });
      } else {
        await update.mutateAsync({
          id: props.group.id,
          input: {
            name: trimmedName,
            selectionType: selectionType as 'single' | 'multi',
            minSelections: min,
            maxSelections: max,
            isActive,
            addonIds: [...addonIds],
          },
        });
      }
      props.onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'save failed');
    }
  }

  const activeAddons = props.allAddons.filter((a) => a.isActive || addonIds.has(a.id));

  return (
    <ModalShell
      title={props.mode === 'create' ? 'New addon group' : `Edit ${existing?.name ?? 'group'}`}
      onClose={props.onClose}
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Name">
          <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} className="w-full input-base text-sm" />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Selection type">
            <select value={selectionType} onChange={(e) => setSelectionType(e.target.value)} className="w-full input-base text-sm">
              <option value="multi">Multi</option>
              <option value="single">Single</option>
            </select>
          </Field>
          <Field label="Min selections">
            <input type="number" min={0} value={minSelections} onChange={(e) => setMinSelections(e.target.value)} className="w-full input-base text-sm" />
          </Field>
          <Field label="Max (0=unlimited)">
            <input type="number" min={0} value={maxSelections} onChange={(e) => setMaxSelections(e.target.value)} className="w-full input-base text-sm" />
          </Field>
        </div>

        {props.mode === 'edit' && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        )}

        <section>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-warm-600">
            Addons in this group
          </div>
          {activeAddons.length === 0 ? (
            <div className="text-xs text-warm-400">No addons available. Create addons first.</div>
          ) : (
            <div className="grid grid-cols-2 gap-1 max-h-40 overflow-auto rounded-md border border-warm-200 p-2">
              {activeAddons.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={addonIds.has(a.id)} onChange={() => toggleAddon(a.id)} />
                  <span>
                    {a.name}{' '}
                    <span className="text-warm-400 tabular-nums font-mono">{formatPaise(a.pricePaise)}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>

        {error && (
          <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">{error}</div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={props.onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ── Shared UI ────────────────────────────────────────────────────────────

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
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
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-warm-600">{label}</div>
      {children}
    </label>
  );
}
