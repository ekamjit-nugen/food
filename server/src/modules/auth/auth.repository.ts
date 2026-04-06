import type { Queryable } from '../../db/index.js';
import type { PublicUser } from './auth.types.js';

/**
 * User repository. Kept in the auth module for now since auth is the only
 * consumer. When user CRUD (list staff, create staff, deactivate staff)
 * lands as its own module, move these into a shared users repo.
 */

interface UserRow {
  id: string;
  tenant_id: string;
  outlet_id: string;
  is_tenant_owner: boolean;
  email: string;
  password_hash: string;
  full_name: string;
  role: 'admin' | 'manager' | 'staff' | 'kitchen';
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserWithSecret extends PublicUser {
  passwordHash: string;
}

function mapUser(row: UserRow): UserWithSecret {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    outletId: row.outlet_id,
    isTenantOwner: row.is_tenant_owner,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    passwordHash: row.password_hash,
  };
}

export function toPublicUser(u: UserWithSecret): PublicUser {
  // Copy every field except passwordHash. Using destructuring would be
  // terser but we spell it out because leaking the hash has real cost.
  return {
    id: u.id,
    tenantId: u.tenantId,
    outletId: u.outletId,
    isTenantOwner: u.isTenantOwner,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended' | 'pending';
}

export async function findActiveTenantBySlug(
  db: Queryable,
  slug: string,
): Promise<TenantRow | null> {
  const { rows } = await db.query<TenantRow>(
    `SELECT id, slug, name, status FROM tenants WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function insertTenant(
  db: Queryable,
  input: { name: string; slug: string; status: 'active' | 'pending' | 'suspended' },
): Promise<TenantRow> {
  const { rows } = await db.query<TenantRow>(
    `INSERT INTO tenants (name, slug, status)
     VALUES ($1, $2, $3)
     RETURNING id, slug, name, status`,
    [input.name, input.slug, input.status],
  );
  return rows[0]!;
}

export async function insertOutlet(
  db: Queryable,
  input: { tenantId: string; name: string },
): Promise<{ id: string }> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO outlets (tenant_id, name) VALUES ($1, $2) RETURNING id`,
    [input.tenantId, input.name],
  );
  return rows[0]!;
}

export async function insertTenantOwner(
  db: Queryable,
  input: {
    tenantId: string;
    outletId: string;
    email: string;
    passwordHash: string;
    fullName: string;
  },
): Promise<UserWithSecret> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (tenant_id, outlet_id, is_tenant_owner, email, password_hash, full_name, role)
     VALUES ($1, $2, TRUE, $3, $4, $5, 'admin')
     RETURNING *`,
    [input.tenantId, input.outletId, input.email, input.passwordHash, input.fullName],
  );
  return mapUser(rows[0]!);
}

/**
 * Return the subset of the given outlet ids that actually belong to the
 * tenant. Used to validate invite payloads: the caller passes outletIds
 * and we refuse if any belong to another tenant or don't exist.
 */
export async function filterOutletsInTenant(
  db: Queryable,
  tenantId: string,
  outletIds: string[],
): Promise<string[]> {
  if (outletIds.length === 0) return [];
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM outlets WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
    [tenantId, outletIds],
  );
  return rows.map((r) => r.id);
}

export interface StaffInviteRow {
  token: string;
  tenant_id: string;
  email: string;
  full_name: string | null;
  invited_by: string;
  role: 'manager' | 'staff' | 'kitchen';
  outlet_ids: string[];
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

export async function insertStaffInvite(
  db: Queryable,
  input: {
    token: string;
    tenantId: string;
    email: string;
    fullName: string | null;
    invitedBy: string;
    role: 'manager' | 'staff' | 'kitchen';
    outletIds: string[];
    expiresAt: Date;
  },
): Promise<StaffInviteRow> {
  const { rows } = await db.query<StaffInviteRow>(
    `INSERT INTO staff_invites (token, tenant_id, email, full_name, invited_by, role, outlet_ids, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8)
     RETURNING token, tenant_id, email, full_name, invited_by, role, outlet_ids, expires_at, consumed_at, created_at`,
    [
      input.token,
      input.tenantId,
      input.email,
      input.fullName,
      input.invitedBy,
      input.role,
      input.outletIds,
      input.expiresAt,
    ],
  );
  return rows[0]!;
}

export async function findInviteByToken(
  db: Queryable,
  token: string,
): Promise<StaffInviteRow | null> {
  const { rows } = await db.query<StaffInviteRow>(
    `SELECT token, tenant_id, email, full_name, invited_by, role, outlet_ids, expires_at, consumed_at, created_at
       FROM staff_invites WHERE token = $1 LIMIT 1`,
    [token],
  );
  return rows[0] ?? null;
}

export async function consumeInvite(db: Queryable, token: string): Promise<void> {
  await db.query(
    `UPDATE staff_invites SET consumed_at = NOW() WHERE token = $1 AND consumed_at IS NULL`,
    [token],
  );
}

export async function grantOutletAccess(
  db: Queryable,
  rows: Array<{ userId: string; outletId: string; role: 'manager' | 'staff' | 'kitchen' }>,
): Promise<void> {
  if (rows.length === 0) return;
  // Build a VALUES list and bulk-insert in a single round-trip. ON CONFLICT
  // makes this idempotent — re-granting access is a no-op.
  const params: unknown[] = [];
  const tuples: string[] = [];
  for (const r of rows) {
    params.push(r.userId, r.outletId, r.role);
    tuples.push(`($${params.length - 2}, $${params.length - 1}, $${params.length}::user_role)`);
  }
  await db.query(
    `INSERT INTO user_outlet_access (user_id, outlet_id, role)
     VALUES ${tuples.join(', ')}
     ON CONFLICT (user_id, outlet_id) DO NOTHING`,
    params,
  );
}

export async function enqueueEmail(
  db: Queryable,
  input: { toEmail: string; template: string; payload: Record<string, unknown> },
): Promise<void> {
  // Email sending is deferred (project decision #3): we write rows to
  // email_outbox and a future worker will pick them up. For dev we also
  // log to the console via the service-layer logger so invite tokens are
  // visible during local testing.
  await db.query(
    `INSERT INTO email_outbox (to_email, template, payload)
     VALUES ($1, $2, $3::jsonb)`,
    [input.toEmail, input.template, JSON.stringify(input.payload)],
  );
}

export async function findUserByTenantAndEmail(
  db: Queryable,
  tenantId: string,
  email: string,
): Promise<UserWithSecret | null> {
  // Email is unique per tenant (see unique index users_tenant_id_email_key).
  // The lookup MUST be scoped to tenant_id so the same email in a different
  // tenant never matches — that would be a cross-tenant auth leak.
  const { rows } = await db.query<UserRow>(
    `SELECT * FROM users
      WHERE tenant_id = $1 AND email = $2 AND is_active = TRUE
      LIMIT 1`,
    [tenantId, email],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function findUserById(
  db: Queryable,
  outletId: string,
  id: string,
): Promise<UserWithSecret | null> {
  const { rows } = await db.query<UserRow>(
    `SELECT * FROM users WHERE outlet_id = $1 AND id = $2`,
    [outletId, id],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function touchLastLogin(db: Queryable, userId: string): Promise<void> {
  await db.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [userId]);
}

export async function updatePasswordHash(
  db: Queryable,
  userId: string,
  newHash: string,
): Promise<void> {
  await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, userId]);
}
