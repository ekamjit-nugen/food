import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shell } from '../shell';
import { useTables, type DiningTable } from '../../lib/tables';
import { useOpenOrders, type Order } from '../../lib/orders';

/**
 * POS Table Grid — the most-used screen in the restaurant.
 *
 * Design: warm neutrals, left-border status accents (green=free, amber=occupied),
 * responsive grid, touch-optimized cards with 44px+ tap targets.
 */
export function PosTables() {
  const tables = useTables();
  const openOrders = useOpenOrders();
  const navigate = useNavigate();

  const openByTable = useMemo(() => {
    const m = new Map<string, Order>();
    for (const o of openOrders.data ?? []) {
      if (o.tableId) m.set(o.tableId, o);
    }
    return m;
  }, [openOrders.data]);

  const openTakeaways = useMemo(
    () => (openOrders.data ?? []).filter((o) => o.orderType === 'takeaway' && o.status === 'open'),
    [openOrders.data],
  );

  const loading = tables.isLoading || openOrders.isLoading;
  const error = tables.error ?? openOrders.error;

  return (
    <Shell title="Tables">
      {/* Header row */}
      <div className="mb-5 flex items-center justify-between">
        <div />
        <button
          onClick={() => navigate('/pos/order/new?type=takeaway')}
          className="btn-primary"
        >
          + New takeaway
        </button>
      </div>

      {loading && <p className="text-warm-500">Loading…</p>}
      {error && (
        <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
          {(error as Error).message}
        </div>
      )}

      {/* Dine-in table grid */}
      {tables.data && tables.data.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {tables.data.map((t, i) => {
            const activeOrder = openByTable.get(t.id) ?? null;
            return (
              <TableCard
                key={t.id}
                table={t}
                activeOrder={activeOrder}
                index={i}
                onClick={() => {
                  if (activeOrder) {
                    navigate(`/pos/order/${activeOrder.id}`);
                  } else {
                    navigate(`/pos/order/new?tableId=${t.id}`);
                  }
                }}
              />
            );
          })}
        </div>
      )}

      {tables.data && tables.data.length === 0 && !loading && (
        <div className="rounded-lg border border-dashed border-warm-300 bg-surface-card p-8 text-center">
          <p className="text-warm-500">No tables set up yet.</p>
          <a href="/admin/tables" className="text-brand font-medium hover:underline text-sm mt-1 inline-block">
            Set up tables
          </a>
        </div>
      )}

      {/* Open takeaway orders */}
      {openTakeaways.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px flex-1 bg-warm-200" />
            <span className="text-xs font-medium uppercase tracking-wide text-warm-500">
              Open takeaway orders
            </span>
            <div className="h-px flex-1 bg-warm-200" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {openTakeaways.map((o) => (
              <button
                key={o.id}
                onClick={() => navigate(`/pos/order/${o.id}`)}
                className="group rounded-md bg-surface-white border border-warm-200 border-l-4 border-l-status-violet
                           p-4 text-left transition-all hover:shadow-md hover:border-warm-300"
              >
                <div className="text-lg font-bold text-warm-900 font-mono">
                  #{o.orderNumber}
                </div>
                {o.customerName && (
                  <div className="text-sm text-warm-600 mt-0.5">{o.customerName}</div>
                )}
                <div className="mt-2">
                  <span className="badge-violet">Takeaway</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}

function TableCard({
  table,
  activeOrder,
  index,
  onClick,
}: {
  table: DiningTable;
  activeOrder: Order | null;
  index: number;
  onClick: () => void;
}) {
  const occupied = !!activeOrder;

  return (
    <button
      onClick={onClick}
      className={
        'group rounded-md bg-surface-white border border-warm-200 border-l-4 p-4 text-left ' +
        'transition-all hover:shadow-md hover:border-warm-300 active:scale-[0.98] ' +
        (occupied ? 'border-l-status-amber' : 'border-l-status-green')
      }
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-lg font-bold text-warm-900">{table.code}</span>
        <span className="text-xs text-warm-500">{table.seats} seats</span>
      </div>

      {table.label && (
        <div className="text-xs text-warm-500 mt-0.5">{table.label}</div>
      )}

      <div className="mt-3">
        {occupied ? (
          <span className="badge-amber">Order #{activeOrder.orderNumber}</span>
        ) : (
          <span className="badge-green">Free</span>
        )}
      </div>
    </button>
  );
}
