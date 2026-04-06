import type { Queryable } from '../../db/index.js';

export interface Outlet {
  id: string;
  tenantId: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface OutletRow {
  id: string;
  tenant_id: string;
  name: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function map(r: OutletRow): Outlet {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    name: r.name,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listByTenant(db: Queryable, tenantId: string): Promise<Outlet[]> {
  const { rows } = await db.query<OutletRow>(
    `SELECT id, tenant_id, name, is_active, created_at, updated_at
       FROM outlets WHERE tenant_id = $1 ORDER BY created_at ASC`,
    [tenantId],
  );
  return rows.map(map);
}

export async function findById(db: Queryable, tenantId: string, id: string): Promise<Outlet | null> {
  const { rows } = await db.query<OutletRow>(
    `SELECT id, tenant_id, name, is_active, created_at, updated_at
       FROM outlets WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return rows[0] ? map(rows[0]) : null;
}

export async function insert(db: Queryable, tenantId: string, name: string): Promise<Outlet> {
  const { rows } = await db.query<OutletRow>(
    `INSERT INTO outlets (tenant_id, name) VALUES ($1, $2)
     RETURNING id, tenant_id, name, is_active, created_at, updated_at`,
    [tenantId, name],
  );
  return map(rows[0]!);
}

export async function update(
  db: Queryable,
  tenantId: string,
  id: string,
  fields: { name?: string; isActive?: boolean },
): Promise<Outlet | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.name !== undefined) { vals.push(fields.name); sets.push(`name = $${vals.length}`); }
  if (fields.isActive !== undefined) { vals.push(fields.isActive); sets.push(`is_active = $${vals.length}`); }
  if (sets.length === 0) return findById(db, tenantId, id);
  vals.push(tenantId, id);
  const { rows } = await db.query<OutletRow>(
    `UPDATE outlets SET ${sets.join(', ')} WHERE tenant_id = $${vals.length - 1} AND id = $${vals.length}
     RETURNING id, tenant_id, name, is_active, created_at, updated_at`,
    vals,
  );
  return rows[0] ? map(rows[0]) : null;
}
