import { pool } from '../../db/index.js';
import type { AuthContext } from '../../middleware/auth.js';
import { writeAudit } from '../../middleware/audit.js';
import { BadRequest, NotFound } from '../../utils/errors.js';
import { broadcastServiceAlert } from '../../ws/kds.js';
import * as repo from './alerts.repository.js';
import type { CreateAlertInput } from './alerts.schemas.js';
import type { ServiceAlert } from './alerts.types.js';

/**
 * Service alerts service.
 *
 * Who can raise: any authenticated user. The whole point of these buttons is
 * that they're frictionless — a staff member on the floor taps once and the
 * kitchen lights up. Gating by role would defeat that.
 *
 * Who can ack: any authenticated user. Same reasoning: the first person who
 * sees the ping and responds should be able to clear it. We still audit who
 * acked, so accountability stays intact.
 *
 * Outlet scope: the alert is created in the actor's current outlet (from
 * req.auth.outletId, which is already tenant-verified by requireAuth). No
 * cross-outlet calls — a manager in outlet A cannot raise an alert in
 * outlet B by sending an X-Outlet-Id header because that header is gated
 * upstream.
 *
 * WS broadcast fires after the DB write commits. If the broadcast throws,
 * the row is still safely written — the REST list is the source of truth
 * and clients catch up on reconnect.
 */

export async function createAlert(
  actor: AuthContext,
  input: CreateAlertInput,
  meta: { requestId?: string; ipAddress?: string } = {},
): Promise<ServiceAlert> {
  // If the caller attached a tableId, assert it belongs to this outlet.
  // Without this check, a client could raise an alert against a table row
  // that lives in another outlet within the same tenant — the alert would
  // still be scoped to the actor's outlet but the FK would dangle visually.
  if (input.tableId) {
    const ok = await repo.tableBelongsToOutlet(pool, actor.outletId, input.tableId);
    if (!ok) throw BadRequest('table does not belong to this outlet');
  }

  const alert = await repo.insertAlert(pool, {
    tenantId: actor.tenantId,
    outletId: actor.outletId,
    kind: input.kind,
    tableId: input.tableId ?? null,
    note: input.note ?? null,
    raisedBy: actor.userId,
  });

  await writeAudit(pool, {
    actor,
    entityType: 'service_alert',
    entityId: alert.id,
    action: 'create',
    after: {
      kind: alert.kind,
      tableId: alert.tableId,
      note: alert.note,
    },
    ...meta,
  });

  // Best-effort broadcast — we deliberately do not `await` a Promise here
  // because broadcastServiceAlert is synchronous; wrapping in try/catch
  // in case a stray socket throws during send.
  try {
    broadcastServiceAlert({ type: 'alert.created', alert });
  } catch {
    // swallow — REST list will reconcile on reconnect
  }

  return alert;
}

export async function ackAlert(
  actor: AuthContext,
  alertId: string,
  meta: { requestId?: string; ipAddress?: string } = {},
): Promise<ServiceAlert> {
  const alert = await repo.ackAlert(pool, actor.outletId, alertId, actor.userId);
  if (!alert) {
    // Either doesn't exist in this outlet, or already acked. We collapse
    // both into NotFound so we don't leak existence across outlets, and
    // the client treats both as "this alert is not actionable anymore".
    throw NotFound('alert');
  }

  await writeAudit(pool, {
    actor,
    entityType: 'service_alert',
    entityId: alert.id,
    action: 'update',
    after: { event: 'alert_acked' },
    ...meta,
  });

  try {
    broadcastServiceAlert({ type: 'alert.acked', alert });
  } catch {
    // swallow
  }

  return alert;
}

export async function listAlerts(
  actor: AuthContext,
  opts: { activeOnly: boolean },
): Promise<ServiceAlert[]> {
  return repo.listAlerts(pool, actor.outletId, opts);
}
