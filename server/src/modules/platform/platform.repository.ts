import type { Queryable } from '../../db/index.js';
import type {
  PlatformStats,
  PlatformTenantDetail,
  PlatformTenantSummary,
  PlatformUser,
  PlatformUserWithSecret,
  TenantStatus,
} from './platform.types.js';

interface PlatformUserRow {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(r: PlatformUserRow): PlatformUserWithSecret {
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name,
    isActive: r.is_active,
    lastLoginAt: r.last_login_at,
    createdAt: r.created_at,
    passwordHash: r.password_hash,
  };
}

export function toPublic(u: PlatformUserWithSecret): PlatformUser {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

export async function findByEmail(
  db: Queryable,
  email: string,
): Promise<PlatformUserWithSecret | null> {
  const { rows } = await db.query<PlatformUserRow>(
    `SELECT * FROM platform_users WHERE email = $1 AND is_active = TRUE LIMIT 1`,
    [email],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function findById(
  db: Queryable,
  id: string,
): Promise<PlatformUserWithSecret | null> {
  const { rows } = await db.query<PlatformUserRow>(
    `SELECT * FROM platform_users WHERE id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function insert(
  db: Queryable,
  input: { email: string; passwordHash: string; fullName: string },
): Promise<PlatformUserWithSecret> {
  const { rows } = await db.query<PlatformUserRow>(
    `INSERT INTO platform_users (email, password_hash, full_name)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [input.email, input.passwordHash, input.fullName],
  );
  return mapRow(rows[0]!);
}

export async function touchLastLogin(db: Queryable, id: string): Promise<void> {
  await db.query(`UPDATE platform_users SET last_login_at = NOW() WHERE id = $1`, [id]);
}

// ---------------------------------------------------------------------------
// Tenant directory (platform console read surface)
// ---------------------------------------------------------------------------

interface TenantSummaryRow {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: string | null;
  created_at: Date;
  outlet_count: string;
  user_count: string;
  paid_bill_count: string;
  lifetime_revenue_paise: string | null;
  owner_email: string | null;
  last_bill_at: Date | null;
}

function mapSummary(r: TenantSummaryRow): PlatformTenantSummary {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    plan: r.plan,
    createdAt: r.created_at,
    outletCount: Number(r.outlet_count),
    userCount: Number(r.user_count),
    paidBillCount: Number(r.paid_bill_count),
    lifetimeRevenuePaise: Number(r.lifetime_revenue_paise ?? 0),
    ownerEmail: r.owner_email,
    lastBillAt: r.last_bill_at,
  };
}

/**
 * Every subquery is correlated on tenant_id, which we backfill NOT NULL on
 * outlets and users, and which was added to bills in Phase 1. Bills without
 * tenant_id (from pre-Phase-2 writes, if any slipped through) are
 * conservatively counted as zero — they never existed in production anyway,
 * only in dev seed data. The "owner" is the first admin user created
 * inside the tenant — in the self-serve signup path that's the signup
 * payload; in invite flows an admin may be promoted later, so this is
 * best-effort identification, not a legal ownership claim.
 */
const TENANT_SUMMARY_SELECT = `
  SELECT t.id,
         t.name,
         t.slug,
         t.status,
         t.plan,
         t.created_at,
         COALESCE((SELECT COUNT(*) FROM outlets o
                    WHERE o.tenant_id = t.id AND o.is_active = TRUE), 0) AS outlet_count,
         COALESCE((SELECT COUNT(*) FROM users u
                    WHERE u.tenant_id = t.id AND u.is_active = TRUE), 0) AS user_count,
         COALESCE((SELECT COUNT(*) FROM bills b
                    WHERE b.tenant_id = t.id AND b.status = 'paid'), 0) AS paid_bill_count,
         COALESCE((SELECT SUM(b.total_paise) FROM bills b
                    WHERE b.tenant_id = t.id AND b.status = 'paid'), 0) AS lifetime_revenue_paise,
         (SELECT u.email FROM users u
           WHERE u.tenant_id = t.id AND u.role = 'admin'
           ORDER BY u.created_at ASC
           LIMIT 1) AS owner_email,
         (SELECT MAX(b.paid_at) FROM bills b
           WHERE b.tenant_id = t.id AND b.status = 'paid') AS last_bill_at
    FROM tenants t
`;

export async function listTenants(
  db: Queryable,
): Promise<PlatformTenantSummary[]> {
  const { rows } = await db.query<TenantSummaryRow>(
    `${TENANT_SUMMARY_SELECT} ORDER BY t.created_at DESC`,
  );
  return rows.map(mapSummary);
}

export async function getTenantDetail(
  db: Queryable,
  tenantId: string,
): Promise<PlatformTenantDetail | null> {
  const { rows } = await db.query<TenantSummaryRow>(
    `${TENANT_SUMMARY_SELECT} WHERE t.id = $1 LIMIT 1`,
    [tenantId],
  );
  if (rows.length === 0) return null;
  const summary = mapSummary(rows[0]!);

  const { rows: outletRows } = await db.query<{
    id: string;
    name: string;
    is_active: boolean;
    created_at: Date;
  }>(
    `SELECT id, name, is_active, created_at
       FROM outlets
      WHERE tenant_id = $1
      ORDER BY created_at ASC`,
    [tenantId],
  );

  // Ten most recently active users — the platform operator mostly cares
  // about "who logged in last" to gauge whether the tenant is alive.
  const { rows: userRows } = await db.query<{
    id: string;
    email: string;
    full_name: string;
    role: 'admin' | 'manager' | 'staff' | 'kitchen';
    is_active: boolean;
    last_login_at: Date | null;
  }>(
    `SELECT id, email, full_name, role, is_active, last_login_at
       FROM users
      WHERE tenant_id = $1
      ORDER BY last_login_at DESC NULLS LAST, created_at DESC
      LIMIT 10`,
    [tenantId],
  );

  return {
    ...summary,
    outlets: outletRows.map((r) => ({
      id: r.id,
      name: r.name,
      isActive: r.is_active,
      createdAt: r.created_at,
    })),
    recentUsers: userRows.map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      role: r.role,
      isActive: r.is_active,
      lastLoginAt: r.last_login_at,
    })),
  };
}

/**
 * Platform-wide rollup for the console header. Two round-trips: one to
 * count tenants by status, one to sum lifetime revenue and bucket recent
 * activity. Kept as separate queries (not a CTE) because the tenants table
 * is small and this runs once per dashboard load — readability wins.
 */
export async function getStats(db: Queryable): Promise<PlatformStats> {
  const { rows: statusRows } = await db.query<{ status: TenantStatus; count: string }>(
    `SELECT status, COUNT(*)::text AS count FROM tenants GROUP BY status`,
  );
  const byStatus: Record<TenantStatus, number> = {
    trial: 0,
    active: 0,
    suspended: 0,
    cancelled: 0,
  };
  let tenantCount = 0;
  for (const row of statusRows) {
    const n = Number(row.count);
    byStatus[row.status] = n;
    tenantCount += n;
  }

  const { rows: revRows } = await db.query<{
    lifetime_revenue_paise: string | null;
    active_7: string;
    active_30: string;
  }>(
    `SELECT
       COALESCE(SUM(total_paise), 0)::text AS lifetime_revenue_paise,
       COUNT(DISTINCT tenant_id) FILTER (WHERE paid_at >= NOW() - INTERVAL '7 days')::text AS active_7,
       COUNT(DISTINCT tenant_id) FILTER (WHERE paid_at >= NOW() - INTERVAL '30 days')::text AS active_30
     FROM bills
     WHERE status = 'paid'`,
  );
  const rev = revRows[0]!;
  return {
    tenantCount,
    byStatus,
    lifetimeRevenuePaise: Number(rev.lifetime_revenue_paise ?? 0),
    activeLast7Days: Number(rev.active_7),
    activeLast30Days: Number(rev.active_30),
  };
}

export async function updateTenantStatus(
  db: Queryable,
  tenantId: string,
  status: TenantStatus,
): Promise<PlatformTenantSummary | null> {
  const isSuspending = status === 'suspended' || status === 'cancelled';
  const { rowCount } = await db.query(
    isSuspending
      ? `UPDATE tenants SET status = $2, suspended_at = NOW(), updated_at = NOW() WHERE id = $1`
      : `UPDATE tenants SET status = $2, suspended_at = NULL, updated_at = NOW() WHERE id = $1`,
    [tenantId, status],
  );
  if (!rowCount) return null;
  // Re-read through the summary select so the caller gets consistent stats.
  const { rows } = await db.query<TenantSummaryRow>(
    `${TENANT_SUMMARY_SELECT} WHERE t.id = $1 LIMIT 1`,
    [tenantId],
  );
  return rows[0] ? mapSummary(rows[0]) : null;
}
