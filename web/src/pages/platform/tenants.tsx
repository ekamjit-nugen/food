import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatPaise } from '../../lib/money';
import {
  platformLogout,
  usePlatformStats,
  useTenants,
  type PlatformTenantSummary,
  type TenantStatus,
} from '../../lib/platform';

/**
 * Platform console — list of every tenant on the SaaS. This is the
 * operator's home page after sign-in. The console is a health-check
 * surface: "which tenants are alive, which are dying, who just signed up,
 * is anybody suspended who shouldn't be?" — not a billing dashboard.
 *
 * Filtering and sorting happen client-side on purpose. The tenant list is
 * small (tens, not thousands) for the foreseeable future, one network
 * round-trip gets the whole set, and the filter UX stays snappy without
 * server round-trips.
 */

type SortKey = 'created_desc' | 'revenue_desc' | 'last_bill_desc' | 'name_asc';

export function PlatformTenantsPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useTenants();
  const { data: stats } = usePlatformStats();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('created_desc');

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const rows = q
      ? data.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.slug.toLowerCase().includes(q) ||
            (t.ownerEmail?.toLowerCase().includes(q) ?? false),
        )
      : data.slice();
    rows.sort((a, b) => compareTenants(a, b, sort));
    return rows;
  }, [data, query, sort]);

  function onLogout() {
    platformLogout();
    navigate('/platform/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Platform console</h1>
          <p className="text-xs text-slate-400">Tenants on this deployment</p>
        </div>
        <button
          onClick={onLogout}
          className="text-sm text-slate-300 hover:text-white px-3 py-1.5 rounded-md border border-slate-700 hover:border-slate-500"
        >
          Sign out
        </button>
      </header>

      <main className="px-6 py-6 space-y-6">
        {stats && (
          <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard label="Tenants" value={String(stats.tenantCount)} />
            <StatCard
              label="Active"
              value={String(stats.byStatus.active)}
              hint={`${stats.byStatus.trial} trial · ${stats.byStatus.suspended} susp.`}
            />
            <StatCard label="Active 7d" value={String(stats.activeLast7Days)} hint="took a payment" />
            <StatCard label="Active 30d" value={String(stats.activeLast30Days)} hint="took a payment" />
            <StatCard label="Lifetime revenue" value={formatPaise(stats.lifetimeRevenuePaise)} />
          </section>
        )}

        <section className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <input
            type="search"
            placeholder="Search by name, slug, or owner email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-slate-900 border border-slate-800 rounded-md px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:border-slate-600"
          />
          <label className="flex items-center gap-2 text-sm text-slate-400">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="bg-slate-900 border border-slate-800 rounded-md px-2 py-2 text-sm text-slate-200 focus:outline-none focus:border-slate-600"
            >
              <option value="created_desc">Newest first</option>
              <option value="last_bill_desc">Last activity</option>
              <option value="revenue_desc">Revenue</option>
              <option value="name_asc">Name A–Z</option>
            </select>
          </label>
        </section>

        {isLoading && <p className="text-slate-400">Loading…</p>}
        {error && (
          <p className="text-red-400">Failed to load tenants. You may need to sign in again.</p>
        )}
        {data && data.length === 0 && (
          <p className="text-slate-400">No tenants yet.</p>
        )}
        {data && data.length > 0 && filtered.length === 0 && (
          <p className="text-slate-400">No tenants match "{query}".</p>
        )}
        {filtered.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Tenant</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium text-right">Outlets</th>
                  <th className="px-4 py-3 font-medium text-right">Users</th>
                  <th className="px-4 py-3 font-medium text-right">Paid bills</th>
                  <th className="px-4 py-3 font-medium text-right">Lifetime revenue</th>
                  <th className="px-4 py-3 font-medium">Last activity</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    className="border-t border-slate-800 hover:bg-slate-900 cursor-pointer"
                    onClick={() => navigate(`/platform/tenants/${t.id}`)}
                  >
                    <td className="px-4 py-3">
                      <Link
                        to={`/platform/tenants/${t.id}`}
                        className="font-medium text-slate-100 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t.name}
                      </Link>
                      <div className="text-xs text-slate-500">{t.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusChip status={t.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-300">{t.ownerEmail ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{t.outletCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{t.userCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{t.paidBillCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatPaise(t.lifetimeRevenuePaise)}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{formatRelative(t.lastBillAt)}</td>
                    <td className="px-4 py-3 text-slate-400">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function compareTenants(a: PlatformTenantSummary, b: PlatformTenantSummary, sort: SortKey): number {
  switch (sort) {
    case 'created_desc':
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    case 'revenue_desc':
      return b.lifetimeRevenuePaise - a.lifetimeRevenuePaise;
    case 'last_bill_desc': {
      // Nulls last — tenants that have never taken a payment sink to the
      // bottom of the "most recently active" view, which is what the
      // operator intuitively expects.
      const at = a.lastBillAt ? new Date(a.lastBillAt).getTime() : -Infinity;
      const bt = b.lastBillAt ? new Date(b.lastBillAt).getTime() : -Infinity;
      return bt - at;
    }
    case 'name_asc':
      return a.name.localeCompare(b.name);
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  if (diffMs < 0) return new Date(iso).toLocaleDateString();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-100 tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function StatusChip({ status }: { status: TenantStatus }) {
  const styles: Record<TenantStatus, string> = {
    trial: 'bg-blue-950 text-blue-300 border-blue-900',
    active: 'bg-emerald-950 text-emerald-300 border-emerald-900',
    suspended: 'bg-amber-950 text-amber-300 border-amber-900',
    cancelled: 'bg-slate-800 text-slate-400 border-slate-700',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
