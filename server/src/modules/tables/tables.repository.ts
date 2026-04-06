import type { Queryable } from '../../db/index.js';
import type { DiningTable } from './tables.types.js';

interface DiningTableRow {
  id: string;
  outlet_id: string;
  code: string;
  label: string | null;
  section: string | null;
  seats: number;
  display_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: DiningTableRow): DiningTable {
  return {
    id: row.id,
    outletId: row.outlet_id,
    code: row.code,
    label: row.label,
    section: row.section,
    seats: row.seats,
    displayOrder: row.display_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertTable(
  db: Queryable,
  params: {
    outletId: string;
    code: string;
    label: string | null;
    section: string | null;
    seats: number;
    displayOrder: number;
  },
): Promise<DiningTable> {
  const { rows } = await db.query<DiningTableRow>(
    `INSERT INTO dining_tables
       (outlet_id, code, label, section, seats, display_order)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      params.outletId,
      params.code,
      params.label,
      params.section,
      params.seats,
      params.displayOrder,
    ],
  );
  return mapRow(rows[0]!);
}

export async function findTableById(
  db: Queryable,
  outletId: string,
  id: string,
): Promise<DiningTable | null> {
  const { rows } = await db.query<DiningTableRow>(
    `SELECT * FROM dining_tables WHERE outlet_id = $1 AND id = $2`,
    [outletId, id],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function listTables(
  db: Queryable,
  outletId: string,
  opts: { includeInactive: boolean; section?: string } = { includeInactive: false },
): Promise<DiningTable[]> {
  const conditions = ['outlet_id = $1'];
  const values: unknown[] = [outletId];
  if (!opts.includeInactive) conditions.push('is_active = TRUE');
  if (opts.section) {
    values.push(opts.section);
    conditions.push(`section = $${values.length}`);
  }
  const { rows } = await db.query<DiningTableRow>(
    `SELECT * FROM dining_tables WHERE ${conditions.join(' AND ')}
     ORDER BY section NULLS FIRST, display_order ASC, code ASC`,
    values,
  );
  return rows.map(mapRow);
}

export async function updateTable(
  db: Queryable,
  outletId: string,
  id: string,
  patch: {
    code?: string;
    label?: string | null;
    section?: string | null;
    seats?: number;
    displayOrder?: number;
    isActive?: boolean;
  },
): Promise<DiningTable | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const map: Record<string, string> = {
    code: 'code',
    label: 'label',
    section: 'section',
    seats: 'seats',
    displayOrder: 'display_order',
    isActive: 'is_active',
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (patch as Record<string, unknown>)[k];
    if (v !== undefined) {
      sets.push(`${col} = $${i++}`);
      values.push(v);
    }
  }
  if (sets.length === 0) {
    return findTableById(db, outletId, id);
  }
  values.push(outletId, id);
  const { rows } = await db.query<DiningTableRow>(
    `UPDATE dining_tables SET ${sets.join(', ')}
     WHERE outlet_id = $${i++} AND id = $${i}
     RETURNING *`,
    values,
  );
  return rows[0] ? mapRow(rows[0]) : null;
}
