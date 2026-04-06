import { useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';
import {
  useTables,
  useCreateTable,
  useUpdateTable,
  type DiningTable,
  type CreateTableInput,
  type UpdateTableInput,
} from '../../lib/tables';
import { useOpenOrders } from '../../lib/orders';

export function AdminTables() {
  const tables = useTables({ includeInactive: true });
  const openOrders = useOpenOrders();
  const [showInactive, setShowInactive] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [editTable, setEditTable] = useState<DiningTable | null>(null);

  const orderByTable = new Map<string, string>();
  for (const o of openOrders.data ?? []) {
    if (o.tableId) orderByTable.set(o.tableId, `Order #${o.orderNumber}`);
  }

  const filtered = (tables.data ?? [])
    .filter((t) => showInactive || t.isActive)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.code.localeCompare(b.code));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tables</h2>
        <button
          onClick={() => setAddModal(true)}
          className="btn-primary"
        >
          + Add table
        </button>
      </div>

      <label className="flex items-center gap-2 text-sm text-warm-600">
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
          className="rounded"
        />
        Show deactivated tables
      </label>

      {tables.isLoading && <p className="text-sm text-warm-500">Loading...</p>}

      <table className="w-full text-sm border border-warm-200 rounded-lg overflow-hidden">
        <thead className="bg-warm-50 text-warm-600">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Code</th>
            <th className="text-left px-3 py-2 font-medium">Label</th>
            <th className="text-right px-3 py-2 font-medium">Seats</th>
            <th className="text-center px-3 py-2 font-medium">Status</th>
            <th className="text-left px-3 py-2 font-medium">Current order</th>
            <th className="text-right px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((t) => (
            <tr
              key={t.id}
              className={`border-t border-warm-100 ${!t.isActive ? 'opacity-50' : ''}`}
            >
              <td className="px-3 py-2 font-semibold">{t.code}</td>
              <td className="px-3 py-2 text-warm-600">{t.label || '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums font-mono">{t.seats}</td>
              <td className="px-3 py-2 text-center">
                {t.isActive ? (
                  <span className="inline-block rounded-full bg-status-green-light text-status-green px-2 py-0.5 text-xs font-medium">
                    Active
                  </span>
                ) : (
                  <span className="inline-block rounded-full bg-status-red-light text-status-red px-2 py-0.5 text-xs font-medium">
                    Inactive
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-warm-600">{orderByTable.get(t.id) ?? '—'}</td>
              <td className="px-3 py-2 text-right space-x-2">
                <button
                  onClick={() => setEditTable(t)}
                  className="text-sm text-warm-600 hover:text-warm-900"
                >
                  Edit
                </button>
                <ToggleActiveButton table={t} />
              </td>
            </tr>
          ))}
          {filtered.length === 0 && !tables.isLoading && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-warm-500">
                No tables found.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {addModal && <AddTableModal onClose={() => setAddModal(false)} />}
      {editTable && <EditTableModal table={editTable} onClose={() => setEditTable(null)} />}
    </div>
  );
}

function ToggleActiveButton({ table }: { table: DiningTable }) {
  const update = useUpdateTable();
  const [error, setError] = useState<string | null>(null);

  if (table.isActive) {
    return (
      <>
        <button
          onClick={async () => {
            setError(null);
            try {
              await update.mutateAsync({ id: table.id, input: { isActive: false } });
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Failed');
              setTimeout(() => setError(null), 3000);
            }
          }}
          disabled={update.isPending}
          className="text-sm text-status-red hover:text-status-red"
        >
          Deactivate
        </button>
        {error && <span className="text-xs text-status-red ml-1">{error}</span>}
      </>
    );
  }
  return (
    <button
      onClick={() => update.mutate({ id: table.id, input: { isActive: true } })}
      disabled={update.isPending}
      className="text-sm text-status-green hover:text-status-green"
    >
      Activate
    </button>
  );
}

const INPUT = 'mt-1 w-full input-base text-sm';

function AddTableModal({ onClose }: { onClose: () => void }) {
  const create = useCreateTable();
  const [code, setCode] = useState('');
  const [seats, setSeats] = useState('4');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const input: CreateTableInput = {
      code: code.trim().toUpperCase(),
      seats: parseInt(seats, 10),
      label: label.trim() || null,
    };
    create.mutate(input, {
      onSuccess: () => onClose(),
      onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed'),
    });
  }

  return (
    <Modal title="Add table" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium text-warm-700">Table code</span>
          <input
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="T10"
            maxLength={20}
            className={INPUT}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-warm-700">Number of seats</span>
          <input
            type="number"
            required
            min={1}
            max={50}
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            className={INPUT}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-warm-700">Label (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Window seat"
            maxLength={50}
            className={INPUT}
          />
        </label>
        {error && (
          <div className="rounded-md bg-status-red-light border border-status-red/20 px-2 py-1 text-xs text-status-red">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={create.isPending} className="flex-1 btn-primary disabled:opacity-60">
            {create.isPending ? 'Adding...' : 'Add table'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditTableModal({ table, onClose }: { table: DiningTable; onClose: () => void }) {
  const update = useUpdateTable();
  const [code, setCode] = useState(table.code);
  const [seats, setSeats] = useState(String(table.seats));
  const [label, setLabel] = useState(table.label ?? '');
  const [displayOrder, setDisplayOrder] = useState(String(table.displayOrder));
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const input: UpdateTableInput = {
      code: code.trim().toUpperCase(),
      seats: parseInt(seats, 10),
      label: label.trim() || null,
      displayOrder: parseInt(displayOrder, 10),
    };
    update.mutate(
      { id: table.id, input },
      {
        onSuccess: () => onClose(),
        onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed'),
      },
    );
  }

  return (
    <Modal title={`Edit table ${table.code}`} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium text-warm-700">Table code</span>
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={20}
            className={INPUT}
          />
          {code !== table.code && (
            <p className="mt-1 text-xs text-status-amber">Changing the code will update how this table appears on the POS.</p>
          )}
        </label>
        <label className="block">
          <span className="text-sm font-medium text-warm-700">Number of seats</span>
          <input type="number" required min={1} max={50} value={seats} onChange={(e) => setSeats(e.target.value)} className={INPUT} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-warm-700">Label (optional)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Window seat" maxLength={50} className={INPUT} />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-warm-700">Display order</span>
          <input type="number" min={0} max={999} value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} className={INPUT} />
        </label>
        {error && (
          <div className="rounded-md bg-status-red-light border border-status-red/20 px-2 py-1 text-xs text-status-red">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={update.isPending} className="flex-1 btn-primary disabled:opacity-60">
            {update.isPending ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-warm-950/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-lg bg-white shadow-lg border border-warm-200 p-5 space-y-3">
        <h2 className="text-base font-semibold text-warm-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}
