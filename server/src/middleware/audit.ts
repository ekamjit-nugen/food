import type { PoolClient } from 'pg';
import type { Queryable } from '../db/index.js';
import type { AuthContext } from './auth.js';

/**
 * Write an audit row. Called explicitly from services, NOT from DB triggers.
 *
 * Why services and not triggers:
 *   - Services have the authenticated actor (req.auth) which the DB does not.
 *   - Services have the request id for correlation across logs.
 *   - Services can decide granularity (e.g., a single "create item with
 *     variations" audit entry rather than 4 separate trigger rows).
 *   - Triggers hide side effects; explicit calls are greppable.
 *
 * The tradeoff is that every write path must remember to call this. We
 * compensate by funnelling all menu writes through service methods that
 * call it inline.
 */
export interface AuditEntry {
  actor: AuthContext;
  entityType: string;
  entityId: string;
  action: 'create' | 'update' | 'delete';
  before?: unknown;
  after?: unknown;
  requestId?: string;
  ipAddress?: string;
}

export async function writeAudit(
  db: Queryable | PoolClient,
  entry: AuditEntry,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (
       tenant_id, outlet_id, actor_id, actor_email,
       entity_type, entity_id, action,
       before, after,
       request_id, ip_address
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)`,
    [
      entry.actor.tenantId,
      entry.actor.outletId,
      entry.actor.userId,
      entry.actor.email,
      entry.entityType,
      entry.entityId,
      entry.action,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
      entry.requestId ?? null,
      entry.ipAddress ?? null,
    ],
  );
}
