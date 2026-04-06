import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { formatPaise } from '../../lib/money';
import {
  useTenant,
  useUpdateTenantStatus,
  type TenantStatus,
} from '../../lib/platform';
import { StatusChip } from './tenants';

/**
 * Tenant detail view. Shows the same summary stats as the list plus a
 * breakdown of outlets and the ten most recently active users. The only
 * mutation available from here is status change — suspend/activate acts as
 * a kill-switch because tenant login already gates on status === 'active'.
 */
export function PlatformTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: tenant, isLoading, error } = useTenant(id);
  const updateStatus = useUpdateTenantStatus();
  const [actionError, setActionError] = useState<string | null>(null);

  async function setStatus(next: TenantStatus) {
    if (!id) return;
    setActionError(null);
    // Suspend is destructive enough to warrant a confirm. Activate / trial /
    // cancelled flow silently — they're reversible and cancelled is mostly
    // bookkeeping.
    if (next === 'suspended') {
      const ok = window.confirm(
        `Suspend "${tenant?.name}"? Their users will be blocked from signing in.`,
      );
      if (!ok) return;
    }
    try {
      await updateStatus.mutateAsync({ id, status: next });
    } catch (err) {
      if (err instanceof ApiError) setActionError(err.message);
      else setActionError('update failed');
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate('/platform/tenants')}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            ← All tenants
          </button>
          <h1 className="text-lg font-semibold mt-1">
            {tenant?.name ?? 'Tenant'}
          </h1>
          {tenant && (
            <p className="text-xs text-slate-500">
              {tenant.slug} · created {new Date(tenant.createdAt).toLocaleDateString()}
            </p>
          )}
        </div>
        {tenant && <StatusChip status={tenant.status} />}
      </header>

      <main className="px-6 py-6 space-y-8 max-w-5xl">
        {isLoading && <p className="text-slate-400">Loading…</p>}
        {error && <p className="text-red-400">Failed to load tenant.</p>}
        {tenant && (
          <>
            <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Outlets" value={tenant.outletCount.toString()} />
              <Stat label="Users" value={tenant.userCount.toString()} />
              <Stat label="Paid bills" value={tenant.paidBillCount.toString()} />
              <Stat
                label="Lifetime revenue"
                value={formatPaise(tenant.lifetimeRevenuePaise)}
              />
            </section>

            <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
              <h2 className="text-sm font-semibold text-slate-200">Status controls</h2>
              <p className="text-xs text-slate-500 mt-1">
                Suspending blocks new logins immediately. Existing tokens remain
                valid until they expire — this is a v1 limitation.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionButton
                  label="Mark active"
                  disabled={tenant.status === 'active' || updateStatus.isPending}
                  onClick={() => setStatus('active')}
                />
                <ActionButton
                  label="Mark trial"
                  disabled={tenant.status === 'trial' || updateStatus.isPending}
                  onClick={() => setStatus('trial')}
                />
                <ActionButton
                  label="Suspend"
                  disabled={tenant.status === 'suspended' || updateStatus.isPending}
                  onClick={() => setStatus('suspended')}
                  tone="danger"
                />
                <ActionButton
                  label="Cancel"
                  disabled={tenant.status === 'cancelled' || updateStatus.isPending}
                  onClick={() => setStatus('cancelled')}
                  tone="danger"
                />
              </div>
              {actionError && (
                <p className="mt-3 text-sm text-red-400">{actionError}</p>
              )}
            </section>

            <section>
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Outlets</h2>
              {tenant.outlets.length === 0 ? (
                <p className="text-sm text-slate-500">No outlets yet.</p>
              ) : (
                <div className="rounded-lg border border-slate-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900 text-slate-400 text-left">
                      <tr>
                        <th className="px-4 py-2 font-medium">Name</th>
                        <th className="px-4 py-2 font-medium">Status</th>
                        <th className="px-4 py-2 font-medium">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tenant.outlets.map((o) => (
                        <tr key={o.id} className="border-t border-slate-800">
                          <td className="px-4 py-2 text-slate-200">{o.name}</td>
                          <td className="px-4 py-2">
                            {o.isActive ? (
                              <span className="text-emerald-400">active</span>
                            ) : (
                              <span className="text-slate-500">inactive</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-slate-400">
                            {new Date(o.createdAt).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section>
              <h2 className="text-sm font-semibold text-slate-200 mb-3">
                Recent users
              </h2>
              {tenant.recentUsers.length === 0 ? (
                <p className="text-sm text-slate-500">No users yet.</p>
              ) : (
                <div className="rounded-lg border border-slate-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-900 text-slate-400 text-left">
                      <tr>
                        <th className="px-4 py-2 font-medium">Email</th>
                        <th className="px-4 py-2 font-medium">Name</th>
                        <th className="px-4 py-2 font-medium">Role</th>
                        <th className="px-4 py-2 font-medium">Last login</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tenant.recentUsers.map((u) => (
                        <tr key={u.id} className="border-t border-slate-800">
                          <td className="px-4 py-2 text-slate-200">{u.email}</td>
                          <td className="px-4 py-2 text-slate-300">{u.fullName}</td>
                          <td className="px-4 py-2 text-slate-400">{u.role}</td>
                          <td className="px-4 py-2 text-slate-400">
                            {u.lastLoginAt
                              ? new Date(u.lastLoginAt).toLocaleString()
                              : 'never'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="text-xs text-slate-500">
              <Link to="/platform/tenants" className="hover:text-slate-300">
                ← Back to tenants
              </Link>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-100 mt-1 tabular-nums">
        {value}
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  tone = 'default',
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}) {
  const base =
    'px-3 py-1.5 rounded-md text-sm font-medium border disabled:opacity-40 disabled:cursor-not-allowed';
  const palette =
    tone === 'danger'
      ? 'border-red-900 text-red-300 hover:bg-red-950'
      : 'border-slate-700 text-slate-200 hover:bg-slate-800';
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${palette}`}>
      {label}
    </button>
  );
}
