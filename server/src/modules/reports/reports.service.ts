import { pool } from '../../db/index.js';
import type { AuthContext } from '../../middleware/auth.js';
import * as repo from './reports.repository.js';
import type {
  DailySalesRow,
  ItemSalesRow,
  CategorySalesRow,
  TaxSummaryRow,
  OrderMasterRow,
} from './reports.repository.js';

/**
 * Reports service — thin. Almost all work lives in the repository
 * aggregation SQL. This layer resolves default date ranges, resolves the
 * caller's report scope to a concrete list of outlet IDs, and bundles the
 * report envelope (echoing the range + scope back so the client can stamp
 * it onto printouts and toggle breakdowns).
 *
 * Scope resolution (Phase 6 — cross-outlet rollups):
 *   - scope='outlet' (default): the caller's current header outlet only.
 *     This preserves every pre-Phase-6 caller.
 *   - scope='tenant': the union of outlets the caller can access inside
 *     their tenant. A tenant owner (isTenantOwner) sees every active
 *     outlet in the tenant; a scoped manager sees only the outlets they
 *     have user_outlet_access rows for. If that intersection is empty we
 *     return an empty aggregate rather than erroring — the repo handles
 *     zero-length outlet arrays explicitly.
 */

export type ReportScope = 'outlet' | 'tenant';

interface Range {
  from: Date;
  to: Date;
}

/**
 * Default range when the client sends nothing: today in UTC.
 * v1 uses UTC everywhere for ranges — the outlet timezone column on
 * `outlets` is stored but not yet applied. The friend's POS should send
 * explicit boundaries in their local TZ; this default is a fallback.
 */
function resolveRange(from?: Date, to?: Date): Range {
  if (from && to) return { from, to };
  const now = new Date();
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return {
    from: from ?? startOfDay,
    to: to ?? new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000),
  };
}

/**
 * Returns the list of outlet IDs the caller is allowed to aggregate over
 * for the given scope. Always returns outlet IDs belonging to the caller's
 * tenant — the WHERE clause on `outlets.tenant_id` is the tenancy guard.
 */
async function resolveOutletScope(
  actor: AuthContext,
  scope: ReportScope,
): Promise<string[]> {
  if (scope === 'outlet') {
    return [actor.outletId];
  }
  // scope === 'tenant'
  if (actor.isTenantOwner) {
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM outlets
        WHERE tenant_id = $1 AND is_active = TRUE
        ORDER BY name ASC`,
      [actor.tenantId],
    );
    return rows.map((r) => r.id);
  }
  // Non-owner: intersect user_outlet_access with active outlets in the
  // caller's tenant. The JOIN on outlets.tenant_id prevents a stale access
  // row from leaking an outlet that was later moved (defense in depth —
  // moving outlets between tenants is not a real feature, but cheap).
  const { rows } = await pool.query<{ outlet_id: string }>(
    `SELECT uoa.outlet_id
       FROM user_outlet_access uoa
       JOIN outlets o ON o.id = uoa.outlet_id
      WHERE uoa.user_id = $1
        AND o.tenant_id = $2
        AND o.is_active = TRUE`,
    [actor.userId, actor.tenantId],
  );
  return rows.map((r) => r.outlet_id);
}

export interface ReportEnvelope<T> {
  range: { from: string; to: string };
  scope: ReportScope;
  outletIds: string[];
  data: T;
}

export async function dailySales(
  actor: AuthContext,
  scope: ReportScope,
  from?: Date,
  to?: Date,
): Promise<ReportEnvelope<DailySalesRow>> {
  const range = resolveRange(from, to);
  const outletIds = await resolveOutletScope(actor, scope);
  const data = await repo.dailySales(pool, outletIds, range.from, range.to);
  return envelope(range, scope, outletIds, data);
}

export async function itemWiseSales(
  actor: AuthContext,
  scope: ReportScope,
  from?: Date,
  to?: Date,
): Promise<ReportEnvelope<ItemSalesRow[]>> {
  const range = resolveRange(from, to);
  const outletIds = await resolveOutletScope(actor, scope);
  const data = await repo.itemWiseSales(pool, outletIds, range.from, range.to);
  return envelope(range, scope, outletIds, data);
}

export async function categoryWiseSales(
  actor: AuthContext,
  scope: ReportScope,
  from?: Date,
  to?: Date,
): Promise<ReportEnvelope<CategorySalesRow[]>> {
  const range = resolveRange(from, to);
  const outletIds = await resolveOutletScope(actor, scope);
  const data = await repo.categoryWiseSales(pool, outletIds, range.from, range.to);
  return envelope(range, scope, outletIds, data);
}

export async function taxSummary(
  actor: AuthContext,
  scope: ReportScope,
  from?: Date,
  to?: Date,
): Promise<ReportEnvelope<TaxSummaryRow[]>> {
  const range = resolveRange(from, to);
  const outletIds = await resolveOutletScope(actor, scope);
  const data = await repo.taxSummary(pool, outletIds, range.from, range.to);
  return envelope(range, scope, outletIds, data);
}

export async function orderMaster(
  actor: AuthContext,
  scope: ReportScope,
  opts: {
    from?: Date;
    to?: Date;
    status?: 'open' | 'closed' | 'cancelled';
    orderType?: 'dine_in' | 'takeaway';
  },
): Promise<ReportEnvelope<OrderMasterRow[]>> {
  const range = resolveRange(opts.from, opts.to);
  const outletIds = await resolveOutletScope(actor, scope);
  const data = await repo.orderMaster(pool, outletIds, {
    from: range.from,
    to: range.to,
    status: opts.status,
    orderType: opts.orderType,
  });
  return envelope(range, scope, outletIds, data);
}

function envelope<T>(
  range: Range,
  scope: ReportScope,
  outletIds: string[],
  data: T,
): ReportEnvelope<T> {
  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    scope,
    outletIds,
    data,
  };
}
