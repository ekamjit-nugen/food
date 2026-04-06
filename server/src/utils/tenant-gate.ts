/**
 * In-memory tenant suspension gate.
 *
 * When a platform admin suspends a tenant, the tenant's id is added to this
 * set. The auth middleware checks it on every request — O(1), no DB hit. The
 * WebSocket layer uses it to kick live connections.
 *
 * The set is primed at startup from the DB (see `primeFromDb`), and kept in
 * sync by the platform service whenever `updateTenantStatus` is called.
 *
 * This is a single-process solution. If you horizontally scale to multiple
 * server instances, you'll need Redis pub/sub or similar to propagate the
 * suspension event across processes. For v1 (single VPS) this is sufficient.
 */

import { childLogger } from './logger.js';

const log = childLogger('tenant-gate');

const suspendedTenants = new Set<string>();

/** Mark a tenant as suspended. Called from platform service. */
export function suspendTenant(tenantId: string): void {
  suspendedTenants.add(tenantId);
  log.info({ tenantId }, 'tenant marked suspended in gate');
}

/** Remove a tenant from the suspended set (reactivated/trial/etc). */
export function unsuspendTenant(tenantId: string): void {
  suspendedTenants.delete(tenantId);
  log.info({ tenantId }, 'tenant unmarked from suspended gate');
}

/** Check if a tenant is currently suspended. Used by auth middleware. */
export function isTenantSuspended(tenantId: string): boolean {
  return suspendedTenants.has(tenantId);
}

/**
 * Prime the gate from the database at startup. Call once during server init,
 * before accepting traffic. This ensures that if the process restarts, tenants
 * that were suspended before the restart are still gated.
 */
export async function primeFromDb(
  query: (sql: string) => Promise<{ rows: { id: string }[] }>,
): Promise<void> {
  const { rows } = await query(
    `SELECT id FROM tenants WHERE status IN ('suspended', 'cancelled')`,
  );
  for (const row of rows) {
    suspendedTenants.add(row.id);
  }
  log.info({ count: rows.length }, 'tenant gate primed from DB');
}

/** Expose the set size for tests / health checks. */
export function suspendedCount(): number {
  return suspendedTenants.size;
}
