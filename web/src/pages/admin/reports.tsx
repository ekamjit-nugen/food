import { useMemo, useState, type ReactNode } from 'react';
import {
  downloadOrderMasterCsv,
  useCategoryWiseSales,
  useDailySales,
  useItemWiseSales,
  useOrderMaster,
  useTaxSummary,
  type CategorySalesRow,
  type DailySalesRow,
  type ItemSalesRow,
  type OrderMasterRow,
  type ReportQuery,
  type ReportScope,
  type TaxSummaryRow,
} from '../../lib/reports';
import { formatPaise } from '../../lib/money';
import { readToken, useAuth } from '../../lib/auth';

type TabId = 'daily' | 'item' | 'category' | 'tax' | 'orders';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'daily', label: 'Daily sales' },
  { id: 'item', label: 'Item-wise' },
  { id: 'category', label: 'Category-wise' },
  { id: 'tax', label: 'Tax summary' },
  { id: 'orders', label: 'Order master' },
];

/**
 * Reports dashboard.
 *
 * Date range uses native <input type="date"> which returns YYYY-MM-DD in the
 * user's local timezone. We convert to a half-open [from, to+1day) ISO
 * interval on submit so the backend gets absolute instants, matching its
 * DateRangeSchema contract. "Today" is the default on mount.
 */
export function AdminReports() {
  const { user } = useAuth();
  const [fromDate, setFromDate] = useState<string>(todayYmd);
  const [toDate, setToDate] = useState<string>(todayYmd);
  const [tab, setTab] = useState<TabId>('daily');
  // Scope toggle is meaningful only when the caller could see more than one
  // outlet — tenant owners and managers can, kitchen/staff cannot even reach
  // this page. Non-owners still get the toggle because they may have
  // user_outlet_access to multiple outlets; the server returns whatever they
  // can actually see. Default 'outlet' preserves the pre-Phase-6 view.
  const [scope, setScope] = useState<ReportScope>('outlet');
  const canCrossOutlet = user?.role === 'admin' || user?.role === 'manager';

  const query = useMemo<ReportQuery>(
    () => ({ ...ymdRangeToIso(fromDate, toDate), scope }),
    [fromDate, toDate, scope],
  );

  return (
    <div>
      <header className="mb-4 flex items-end justify-between gap-4 flex-wrap">
        <h2 className="text-lg font-semibold">Reports</h2>
        <div className="flex items-end gap-2">
          {canCrossOutlet && (
            <div className="text-xs text-warm-600">
              <div>Scope</div>
              <div className="mt-1 inline-flex rounded-md border border-warm-300 overflow-hidden">
                <ScopeButton
                  active={scope === 'outlet'}
                  onClick={() => setScope('outlet')}
                  label="This outlet"
                />
                <ScopeButton
                  active={scope === 'tenant'}
                  onClick={() => setScope('tenant')}
                  label="All outlets"
                />
              </div>
            </div>
          )}
          <label className="text-xs text-warm-600">
            <div>From</div>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="mt-1 input-base text-sm"
            />
          </label>
          <label className="text-xs text-warm-600">
            <div>To</div>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="mt-1 input-base text-sm"
            />
          </label>
        </div>
      </header>

      <nav className="flex gap-1 mb-4 border-b border-warm-200">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition ' +
                (active
                  ? 'border-warm-900 text-warm-900'
                  : 'border-transparent text-warm-500 hover:text-warm-800')
              }
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'daily' && <DailyPanel query={query} />}
      {tab === 'item' && <ItemPanel query={query} />}
      {tab === 'category' && <CategoryPanel query={query} />}
      {tab === 'tax' && <TaxPanel query={query} />}
      {tab === 'orders' && <OrdersPanel query={query} />}
    </div>
  );
}

function ScopeButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-3 py-1.5 text-xs font-medium transition ' +
        (active
          ? 'bg-warm-900 text-white'
          : 'bg-white text-warm-700 hover:bg-warm-100')
      }
    >
      {label}
    </button>
  );
}

// ---- Panels ---------------------------------------------------------------

function DailyPanel({ query }: { query: ReportQuery }) {
  const q = useDailySales(query);
  return (
    <PanelFrame query={q}>
      {q.data && <DailyView row={q.data.data} />}
    </PanelFrame>
  );
}

function DailyView({ row }: { row: DailySalesRow }) {
  // Show the per-outlet breakdown only when it's interesting — i.e. when
  // the response spans more than one outlet. Single-outlet tenants (v1
  // baseline) continue to see the classic totals-only layout.
  const showByOutlet = row.byOutlet.length > 1;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Bills" value={String(row.totalBills)} />
        <StatCard label="Revenue" value={formatPaise(row.totalRevenuePaise)} />
        <StatCard label="Tax" value={formatPaise(row.totalTaxPaise)} />
        <StatCard label="Discount" value={formatPaise(row.totalDiscountPaise)} />
      </div>

      {showByOutlet && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-warm-500 mb-2">
            By outlet
          </h3>
          <MiniTable
            headers={['Outlet', 'Bills', 'Revenue']}
            rows={row.byOutlet.map((o) => [
              o.outletName,
              String(o.bills),
              formatPaise(o.revenuePaise),
            ])}
            numericColumns={[1, 2]}
          />
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-warm-500 mb-2">
          By order type
        </h3>
        <MiniTable
          headers={['Type', 'Bills', 'Revenue']}
          rows={row.byOrderType.map((t) => [
            t.orderType,
            String(t.bills),
            formatPaise(t.revenuePaise),
          ])}
          numericColumns={[1, 2]}
        />
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-warm-500 mb-2">
          By payment method
        </h3>
        <MiniTable
          headers={['Method', 'Payments', 'Amount']}
          rows={row.byPaymentMethod.map((p) => [
            p.method,
            String(p.payments),
            formatPaise(p.amountPaise),
          ])}
          numericColumns={[1, 2]}
        />
      </section>
    </div>
  );
}

function ItemPanel({ query }: { query: ReportQuery }) {
  const q = useItemWiseSales(query);
  return (
    <PanelFrame query={q}>
      {q.data && <ItemTable rows={q.data.data} />}
    </PanelFrame>
  );
}

function ItemTable({ rows }: { rows: ItemSalesRow[] }) {
  if (rows.length === 0) return <EmptyNote />;
  return (
    <MiniTable
      headers={['Item', 'Qty', 'Gross', 'Discount', 'Tax', 'Net']}
      rows={rows.map((r) => [
        r.variationName ? `${r.menuItemName} (${r.variationName})` : r.menuItemName,
        String(r.quantity),
        formatPaise(r.grossPaise),
        formatPaise(r.discountPaise),
        formatPaise(r.taxPaise),
        formatPaise(r.netPaise),
      ])}
      numericColumns={[1, 2, 3, 4, 5]}
    />
  );
}

function CategoryPanel({ query }: { query: ReportQuery }) {
  const q = useCategoryWiseSales(query);
  return (
    <PanelFrame query={q}>
      {q.data && <CategoryTable rows={q.data.data} />}
    </PanelFrame>
  );
}

function CategoryTable({ rows }: { rows: CategorySalesRow[] }) {
  if (rows.length === 0) return <EmptyNote />;
  return (
    <MiniTable
      headers={['Category', 'Qty', 'Net']}
      rows={rows.map((r) => [
        r.categoryName ?? '(uncategorised)',
        String(r.quantity),
        formatPaise(r.netPaise),
      ])}
      numericColumns={[1, 2]}
    />
  );
}

function TaxPanel({ query }: { query: ReportQuery }) {
  const q = useTaxSummary(query);
  return (
    <PanelFrame query={q}>
      {q.data && <TaxTable rows={q.data.data} />}
    </PanelFrame>
  );
}

function TaxTable({ rows }: { rows: TaxSummaryRow[] }) {
  if (rows.length === 0) return <EmptyNote />;
  return (
    <MiniTable
      headers={['Rate', 'Taxable base', 'CGST', 'SGST', 'Total tax']}
      rows={rows.map((r) => [
        `${(r.taxRateBps / 100).toFixed(2)}%`,
        formatPaise(r.taxableBasePaise),
        formatPaise(r.cgstPaise),
        formatPaise(r.sgstPaise),
        formatPaise(r.totalTaxPaise),
      ])}
      numericColumns={[1, 2, 3, 4]}
    />
  );
}

function OrdersPanel({ query }: { query: ReportQuery }) {
  const q = useOrderMaster(query);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function onDownload() {
    setDownloadError(null);
    const token = readToken();
    if (!token) {
      setDownloadError('not signed in');
      return;
    }
    setDownloading(true);
    try {
      await downloadOrderMasterCsv(query, token);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'download failed');
    } finally {
      setDownloading(false);
    }
  }

  // When the response covers more than one outlet (scope=tenant with a
  // multi-outlet tenant), slot an extra "Outlet" column in so the owner
  // can tell rows apart at a glance. Single-outlet responses keep the
  // classic compact layout.
  const multiOutlet = q.data
    ? new Set(q.data.data.map((r) => r.outletId)).size > 1
    : false;

  return (
    <PanelFrame query={q}>
      <div className="flex justify-end mb-3">
        <button
          onClick={onDownload}
          disabled={downloading}
          className="btn-secondary disabled:opacity-60"
        >
          {downloading ? 'Downloading…' : 'Download CSV'}
        </button>
      </div>
      {downloadError && (
        <div className="mb-3 rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
          {downloadError}
        </div>
      )}
      {q.data && <OrdersTable rows={q.data.data} showOutlet={multiOutlet} />}
    </PanelFrame>
  );
}

function OrdersTable({
  rows,
  showOutlet,
}: {
  rows: OrderMasterRow[];
  showOutlet: boolean;
}) {
  if (rows.length === 0) return <EmptyNote />;
  const baseHeaders = ['#', 'Type', 'Status', 'Table', 'Bill', 'Total', 'Opened'];
  const headers = showOutlet
    ? ['#', 'Outlet', 'Type', 'Status', 'Table', 'Bill', 'Total', 'Opened']
    : baseHeaders;
  const numericColumns = showOutlet ? [6] : [5];
  return (
    <MiniTable
      headers={headers}
      rows={rows.map((r) => {
        const base = [
          `#${r.orderNumber}`,
          r.orderType,
          r.status,
          r.tableCode ?? '—',
          r.billNumber !== null ? `#${r.billNumber} (${r.billStatus ?? 'n/a'})` : '—',
          r.totalPaise !== null ? formatPaise(r.totalPaise) : '—',
          new Date(r.openedAt).toLocaleString(),
        ];
        return showOutlet ? [base[0]!, r.outletName, ...base.slice(1)] : base;
      })}
      numericColumns={numericColumns}
    />
  );
}

// ---- Shared primitives ----------------------------------------------------

function PanelFrame({
  query,
  children,
}: {
  query: { isLoading: boolean; error: unknown };
  children: ReactNode;
}) {
  return (
    <div>
      {query.isLoading && <div className="text-warm-500">Loading…</div>}
      {query.error ? (
        <div className="rounded-md bg-status-red-light border border-status-red/20 px-3 py-2 text-sm text-status-red">
          {(query.error as Error).message}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-warm-200 bg-white p-3">
      <div className="text-xs uppercase tracking-wide text-warm-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums font-mono">{value}</div>
    </div>
  );
}

function MiniTable({
  headers,
  rows,
  numericColumns = [],
}: {
  headers: string[];
  rows: string[][];
  numericColumns?: number[];
}) {
  const rightSet = new Set(numericColumns);
  return (
    <div className="rounded-lg border border-warm-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-warm-50 text-warm-600">
          <tr>
            {headers.map((h, i) => (
              <th
                key={h}
                className={
                  'font-medium px-3 py-2 ' + (rightSet.has(i) ? 'text-right' : 'text-left')
                }
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-t border-warm-100">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={
                    'px-3 py-2 ' + (rightSet.has(ci) ? 'text-right tabular-nums font-mono' : '')
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyNote() {
  return (
    <div className="rounded-lg border border-dashed border-warm-300 bg-white p-6 text-center text-warm-500 text-sm">
      No data in this range.
    </div>
  );
}

// ---- helpers --------------------------------------------------------------

/** YYYY-MM-DD in the user's local timezone for "today". */
function todayYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = (now.getMonth() + 1).toString().padStart(2, '0');
  const d = now.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Convert [fromYmd, toYmd] (both local dates, inclusive) into a half-open
 * ISO range [from 00:00 local, to+1 00:00 local) so the backend sees a
 * complete final day without including any of the next day.
 */
function ymdRangeToIso(fromYmd: string, toYmd: string): { from: string; to: string } {
  const from = new Date(`${fromYmd}T00:00:00`);
  const toStart = new Date(`${toYmd}T00:00:00`);
  const toExclusive = new Date(toStart.getTime() + 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: toExclusive.toISOString(),
  };
}
