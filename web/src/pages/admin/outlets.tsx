import { useState, type FormEvent } from 'react';
import { Store, Plus } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { useOutlets, useCreateOutlet, useUpdateOutlet, type Outlet } from '../../lib/outlets';

export function AdminOutlets() {
  const { data: outlets, isLoading } = useOutlets();
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Outlets</h2>
        <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Add outlet
        </button>
      </div>

      <p className="text-sm text-warm-500">
        Each outlet is a physical location with its own menu, tables, staff, and billing. The tenant owner has access to all outlets.
      </p>

      {isLoading && <p className="text-sm text-warm-500">Loading...</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(outlets ?? []).map((o) => (
          <OutletCard key={o.id} outlet={o} />
        ))}
      </div>

      {showAdd && <AddOutletModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}

function OutletCard({ outlet }: { outlet: Outlet }) {
  const update = useUpdateOutlet();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(outlet.name);
  const [error, setError] = useState<string | null>(null);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await update.mutateAsync({ id: outlet.id, input: { name: name.trim() } });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed');
    }
  }

  return (
    <div className="rounded-md border border-warm-200 bg-surface-white p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-sm bg-brand-light text-brand flex items-center justify-center">
            <Store className="w-4 h-4" />
          </div>
          <div>
            {editing ? (
              <form onSubmit={onSave} className="flex items-center gap-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-base h-8 text-sm w-48"
                  autoFocus
                />
                <button type="submit" disabled={update.isPending} className="btn-primary text-xs px-2 py-1">
                  Save
                </button>
                <button type="button" onClick={() => { setEditing(false); setName(outlet.name); }} className="btn-ghost text-xs px-2 py-1">
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <div className="text-sm font-semibold text-warm-900">{outlet.name}</div>
                <div className="text-xs text-warm-500 font-mono">{outlet.id.slice(0, 8)}</div>
              </>
            )}
          </div>
        </div>
        {!editing && (
          <div className="flex items-center gap-2">
            {outlet.isActive ? (
              <span className="badge-green">Active</span>
            ) : (
              <span className="badge-red">Inactive</span>
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-status-red">{error}</p>}
      {!editing && (
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => setEditing(true)} className="text-xs text-warm-600 hover:text-warm-900">
            Edit name
          </button>
          {outlet.isActive ? (
            <button
              onClick={() => update.mutate({ id: outlet.id, input: { isActive: false } })}
              disabled={update.isPending}
              className="text-xs text-status-red hover:text-status-red/80"
            >
              Deactivate
            </button>
          ) : (
            <button
              onClick={() => update.mutate({ id: outlet.id, input: { isActive: true } })}
              disabled={update.isPending}
              className="text-xs text-status-green hover:text-status-green/80"
            >
              Activate
            </button>
          )}
        </div>
      )}
      <div className="mt-2 text-[11px] text-warm-400">
        Created {new Date(outlet.createdAt).toLocaleDateString()}
      </div>
    </div>
  );
}

function AddOutletModal({ onClose }: { onClose: () => void }) {
  const create = useCreateOutlet();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({ name: name.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed');
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-warm-950/50 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg bg-surface-white shadow-xl border border-warm-200 p-5 space-y-4"
      >
        <h2 className="text-base font-semibold text-warm-900">Add outlet</h2>
        <p className="text-sm text-warm-500">
          Create a new physical location. It will have its own menu, tables, and staff.
        </p>
        <label className="block">
          <span className="text-sm font-medium text-warm-700 mb-1.5 block">Outlet name</span>
          <input
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Downtown Branch"
            className="input-base"
          />
        </label>
        {error && (
          <div className="rounded-sm bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={create.isPending} className="btn-primary flex-1">
            {create.isPending ? 'Creating...' : 'Create outlet'}
          </button>
        </div>
      </form>
    </div>
  );
}
