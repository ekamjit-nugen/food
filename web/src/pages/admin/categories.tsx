import { useState, type FormEvent, type ReactNode } from 'react';
import {
  useCategories,
  useCreateCategory,
  useDeactivateCategory,
  useUpdateCategory,
  type Category,
} from '../../lib/menu';
import { ApiError } from '../../lib/auth';

/**
 * Admin categories page.
 *
 * CRUD against /menu/categories. Deactivate is a soft delete on the server
 * (isActive=false); we still render deactivated rows so admin can see and
 * potentially restore them via the edit dialog.
 */
export function AdminCategories() {
  const { data, isLoading, error } = useCategories();
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Categories</h2>
        <button
          onClick={() => setCreating(true)}
          className="btn-primary"
        >
          New category
        </button>
      </header>

      {isLoading && <div className="text-warm-500">Loading…</div>}
      {error && (
        <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
          {(error as Error).message}
        </div>
      )}

      {data && <CategoryTable rows={data} onEdit={setEditing} />}

      {creating && <CategoryFormModal mode="create" onClose={() => setCreating(false)} />}
      {editing && (
        <CategoryFormModal
          mode="edit"
          category={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function CategoryTable({
  rows,
  onEdit,
}: {
  rows: Category[];
  onEdit: (c: Category) => void;
}) {
  const deactivate = useDeactivateCategory();
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-warm-300 bg-white p-6 text-center text-warm-500">
        No categories yet.
      </div>
    );
  }
  const sorted = [...rows].sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
  return (
    <div className="rounded-lg border border-warm-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-warm-50 text-warm-600">
          <tr>
            <th className="text-left font-medium px-4 py-2">Name</th>
            <th className="text-left font-medium px-4 py-2">Description</th>
            <th className="text-right font-medium px-4 py-2">Order</th>
            <th className="text-center font-medium px-4 py-2">Active</th>
            <th className="text-right font-medium px-4 py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.id} className="border-t border-warm-100">
              <td className="px-4 py-3 font-medium text-warm-900">{c.name}</td>
              <td className="px-4 py-3 text-warm-600 truncate max-w-sm">{c.description ?? '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums font-mono">{c.displayOrder}</td>
              <td className="px-4 py-3 text-center">
                {c.isActive ? (
                  <span className="text-status-green">yes</span>
                ) : (
                  <span className="text-warm-400">no</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => onEdit(c)}
                  className="text-sm font-medium text-warm-700 hover:text-warm-900 mr-3"
                >
                  Edit
                </button>
                {c.isActive && (
                  <button
                    onClick={() => {
                      if (confirm(`Deactivate "${c.name}"?`)) deactivate.mutate(c.id);
                    }}
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

function CategoryFormModal(
  props:
    | { mode: 'create'; onClose: () => void }
    | { mode: 'edit'; category: Category; onClose: () => void },
) {
  const initial = props.mode === 'edit' ? props.category : null;
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [displayOrder, setDisplayOrder] = useState<string>(String(initial?.displayOrder ?? 0));
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateCategory();
  const update = useUpdateCategory();
  const pending = create.isPending || update.isPending;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('name is required');
      return;
    }
    const orderNum = Number(displayOrder);
    if (!Number.isInteger(orderNum) || orderNum < 0) {
      setError('display order must be a non-negative integer');
      return;
    }
    try {
      if (props.mode === 'create') {
        await create.mutateAsync({
          name: trimmedName,
          description: description.trim() || null,
          displayOrder: orderNum,
        });
      } else {
        await update.mutateAsync({
          id: props.category.id,
          input: {
            name: trimmedName,
            description: description.trim() || null,
            displayOrder: orderNum,
            isActive,
          },
        });
      }
      props.onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'save failed');
    }
  }

  return (
    <ModalShell title={props.mode === 'create' ? 'New category' : 'Edit category'} onClose={props.onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Name">
          <input
            type="text"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            className="w-full input-base text-sm"
          />
        </Field>
        <Field label="Description (optional)">
          <textarea
            value={description ?? ''}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full input-base text-sm"
          />
        </Field>
        <Field label="Display order">
          <input
            type="number"
            min={0}
            value={displayOrder}
            onChange={(e) => setDisplayOrder(e.target.value)}
            className="w-32 input-base text-sm"
          />
        </Field>
        {props.mode === 'edit' && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Active
          </label>
        )}
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
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-warm-200 px-4 py-3">
          <h3 className="text-base font-semibold">{title}</h3>
        </div>
        <div className="p-4">{children}</div>
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
