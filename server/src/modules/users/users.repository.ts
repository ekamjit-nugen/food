import type { Queryable } from '../../db/index.js';
import type { PublicUser } from '../auth/auth.types.js';

/**
 * User CRUD queries for the admin-facing /users endpoints.
 *
 * Distinct from auth.repository which models "a logged-in user finding
 * themselves" — those paths filter by is_active. The admin path here
 * needs to see deactivated users too (to reactivate them, or to list the
 * full audit trail).
 */

interface UserRow {
  id: string;
  tenant_id: string;
  outlet_id: string;
  is_tenant_owner: boolean;
  email: string;
  full_name: string;
  role: 'admin' | 'manager' | 'staff' | 'kitchen';
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

function mapUser(row: UserRow): PublicUser {
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
  };
}

const SELECT_PUBLIC =
  `SELECT id, tenant_id, outlet_id, is_tenant_owner, email, full_name, role, is_active, last_login_at, created_at FROM users`;

export async function listUsers(
  db: Queryable,
  outletId: string,
  opts: { role?: PublicUser['role']; includeInactive?: boolean } = {},
): Promise<PublicUser[]> {
  const where: string[] = ['outlet_id = $1'];
  const params: unknown[] = [outletId];
  if (opts.role) {
    params.push(opts.role);
    where.push(`role = $${params.length}`);
  }
  if (!opts.includeInactive) {
    where.push('is_active = TRUE');
  }
  const { rows } = await db.query<UserRow>(
    `${SELECT_PUBLIC} WHERE ${where.join(' AND ')} ORDER BY created_at`,
    params,
  );
  return rows.map(mapUser);
}

export async function findById(
  db: Queryable,
  outletId: string,
  id: string,
): Promise<PublicUser | null> {
  const { rows } = await db.query<UserRow>(
    `${SELECT_PUBLIC} WHERE outlet_id = $1 AND id = $2`,
    [outletId, id],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function emailExistsInOutlet(
  db: Queryable,
  outletId: string,
  email: string,
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE outlet_id = $1 AND email = $2 LIMIT 1`,
    [outletId, email],
  );
  return rows.length > 0;
}

export async function insertUser(
  db: Queryable,
  input: {
    tenantId: string;
    outletId: string;
    email: string;
    passwordHash: string;
    fullName: string;
    role: PublicUser['role'];
  },
): Promise<PublicUser> {
  const { rows } = await db.query<UserRow>(
    `INSERT INTO users (tenant_id, outlet_id, email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, tenant_id, outlet_id, is_tenant_owner, email, full_name, role, is_active, last_login_at, created_at`,
    [input.tenantId, input.outletId, input.email, input.passwordHash, input.fullName, input.role],
  );
  return mapUser(rows[0]!);
}

export async function updateUser(
  db: Queryable,
  outletId: string,
  id: string,
  patch: { fullName?: string; role?: PublicUser['role']; isActive?: boolean },
): Promise<PublicUser | null> {
  // Build the SET clause dynamically. We only ever touch the fields the
  // caller actually passed — never overwrite with NULL by accident.
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.fullName !== undefined) {
    params.push(patch.fullName);
    sets.push(`full_name = $${params.length}`);
  }
  if (patch.role !== undefined) {
    params.push(patch.role);
    sets.push(`role = $${params.length}`);
  }
  if (patch.isActive !== undefined) {
    params.push(patch.isActive);
    sets.push(`is_active = $${params.length}`);
  }
  if (sets.length === 0) {
    // Caller already validated this, but refuse a no-op as a safety net.
    return findById(db, outletId, id);
  }
  params.push(outletId, id);
  const { rows } = await db.query<UserRow>(
    `UPDATE users SET ${sets.join(', ')}
      WHERE outlet_id = $${params.length - 1} AND id = $${params.length}
      RETURNING id, tenant_id, outlet_id, is_tenant_owner, email, full_name, role, is_active, last_login_at, created_at`,
    params,
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

/**
 * Count currently active admins in an outlet. Used to refuse the last-admin
 * lockout — if you demote or deactivate the final admin, nobody can log in
 * to fix the mess.
 */
export async function countActiveAdmins(
  db: Queryable,
  outletId: string,
): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT COUNT(*)::bigint AS n FROM users
      WHERE outlet_id = $1 AND role = 'admin' AND is_active = TRUE`,
    [outletId],
  );
  return Number(rows[0]!.n);
}
