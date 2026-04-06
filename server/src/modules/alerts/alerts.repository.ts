import type { Queryable } from '../../db/index.js';
import type { ServiceAlert, ServiceAlertKind } from './alerts.types.js';

/**
 * Service alert repository. All SQL lives here; callers never issue queries
 * directly. Every read and every write filters on outlet_id — alerts are
 * strictly per-outlet, and tenant_id is carried denormalized for belt-and-
 * braces RLS later.
 */

interface AlertRow {
  id: string;
  tenant_id: string;
  outlet_id: string;
  kind: ServiceAlertKind;
  table_id: string | null;
  note: string | null;
  raised_by: string;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  created_at: Date;
}

function mapAlert(row: AlertRow): ServiceAlert {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    outletId: row.outlet_id,
    kind: row.kind,
    tableId: row.table_id,
    note: row.note,
    raisedBy: row.raised_by,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
    createdAt: row.created_at,
  };
}

export async function insertAlert(
  q: Queryable,
  input: {
    tenantId: string;
    outletId: string;
    kind: ServiceAlertKind;
    tableId: string | null;
    note: string | null;
    raisedBy: string;
  },
): Promise<ServiceAlert> {
  const { rows } = await q.query<AlertRow>(
    `INSERT INTO service_alerts
       (tenant_id, outlet_id, kind, table_id, note, raised_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.tenantId,
      input.outletId,
      input.kind,
      input.tableId,
      input.note,
      input.raisedBy,
    ],
  );
  return mapAlert(rows[0]!);
}

/** Assert that a dining table belongs to this outlet. Used before attaching
 *  a tableId to an alert so we can't attach a cross-outlet table row. */
export async function tableBelongsToOutlet(
  q: Queryable,
  outletId: string,
  tableId: string,
): Promise<boolean> {
  const { rows } = await q.query<{ exists: boolean }>(
    `SELECT TRUE AS exists FROM dining_tables
      WHERE id = $1 AND outlet_id = $2
      LIMIT 1`,
    [tableId, outletId],
  );
  return rows.length > 0;
}

export async function findAlertById(
  q: Queryable,
  outletId: string,
  id: string,
): Promise<ServiceAlert | null> {
  const { rows } = await q.query<AlertRow>(
    `SELECT * FROM service_alerts
      WHERE id = $1 AND outlet_id = $2
      LIMIT 1`,
    [id, outletId],
  );
  return rows[0] ? mapAlert(rows[0]) : null;
}

/** Atomic ack. Returns null if the alert was already acked or doesn't exist
 *  in this outlet — the caller maps that to 404/409. */
export async function ackAlert(
  q: Queryable,
  outletId: string,
  id: string,
  ackedBy: string,
): Promise<ServiceAlert | null> {
  const { rows } = await q.query<AlertRow>(
    `UPDATE service_alerts
        SET acknowledged_at = NOW(), acknowledged_by = $3
      WHERE id = $1 AND outlet_id = $2 AND acknowledged_at IS NULL
      RETURNING *`,
    [id, outletId, ackedBy],
  );
  return rows[0] ? mapAlert(rows[0]) : null;
}

export async function listAlerts(
  q: Queryable,
  outletId: string,
  opts: { activeOnly: boolean },
): Promise<ServiceAlert[]> {
  const { rows } = await q.query<AlertRow>(
    opts.activeOnly
      ? `SELECT * FROM service_alerts
           WHERE outlet_id = $1 AND acknowledged_at IS NULL
           ORDER BY created_at DESC`
      : `SELECT * FROM service_alerts
           WHERE outlet_id = $1
           ORDER BY created_at DESC
           LIMIT 200`,
    [outletId],
  );
  return rows.map(mapAlert);
}
