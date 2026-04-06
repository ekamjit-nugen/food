import type { Queryable } from '../../db/index.js';
import type { UserDevice } from './devices.types.js';

/**
 * Device & pairing-code repository. All SQL lives here; service and
 * controller never execute queries directly.
 */

interface DeviceRow {
  id: string;
  tenant_id: string;
  user_id: string;
  outlet_id: string;
  label: string;
  platform: string | null;
  token_hash: string;
  last_seen_at: Date | null;
  last_ip: string | null;
  revoked_at: Date | null;
  revoked_by: string | null;
  created_at: Date;
}

function mapDevice(row: DeviceRow): UserDevice {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    outletId: row.outlet_id,
    label: row.label,
    platform: row.platform,
    lastSeenAt: row.last_seen_at,
    lastIp: row.last_ip,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    createdAt: row.created_at,
  };
}

export interface DeviceWithSecret extends UserDevice {
  tokenHash: string;
}

function mapDeviceWithSecret(row: DeviceRow): DeviceWithSecret {
  return { ...mapDevice(row), tokenHash: row.token_hash };
}

// ---------------------------------------------------------------------------
// user_devices
// ---------------------------------------------------------------------------

export async function insertDevice(
  q: Queryable,
  input: {
    tenantId: string;
    userId: string;
    outletId: string;
    label: string;
    platform: string | null;
    tokenHash: string;
    firstSeenIp: string | null;
  },
): Promise<UserDevice> {
  const { rows } = await q.query<DeviceRow>(
    `INSERT INTO user_devices
       (tenant_id, user_id, outlet_id, label, platform, token_hash, last_seen_at, last_ip)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
     RETURNING *`,
    [
      input.tenantId,
      input.userId,
      input.outletId,
      input.label,
      input.platform,
      input.tokenHash,
      input.firstSeenIp,
    ],
  );
  return mapDevice(rows[0]!);
}

/** Look up a device by its UUID prefix. Used during device-login: the mobile
 *  app sends `<deviceId>.<secret>`; we split, fetch by id, then bcrypt the
 *  secret. Returns the token_hash so the caller can verify. */
export async function findDeviceForLogin(
  q: Queryable,
  deviceId: string,
): Promise<DeviceWithSecret | null> {
  // UUID shape-check before the query so a garbage prefix can't cast-error.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
    return null;
  }
  const { rows } = await q.query<DeviceRow>(
    `SELECT * FROM user_devices WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1`,
    [deviceId],
  );
  return rows[0] ? mapDeviceWithSecret(rows[0]) : null;
}

export async function touchDeviceLastSeen(
  q: Queryable,
  deviceId: string,
  ip: string | null,
): Promise<void> {
  await q.query(
    `UPDATE user_devices SET last_seen_at = NOW(), last_ip = $2 WHERE id = $1`,
    [deviceId, ip],
  );
}

export async function listDevicesForUser(
  q: Queryable,
  tenantId: string,
  userId: string,
): Promise<UserDevice[]> {
  const { rows } = await q.query<DeviceRow>(
    `SELECT * FROM user_devices
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY revoked_at IS NULL DESC, created_at DESC`,
    [tenantId, userId],
  );
  return rows.map(mapDevice);
}

/** Revoke a device. Returns the updated row or null if not found / wrong
 *  tenant / already revoked. The tenant guard is essential: a compromised
 *  admin in tenant A must not be able to revoke a device in tenant B. */
export async function revokeDevice(
  q: Queryable,
  tenantId: string,
  deviceId: string,
  revokedBy: string,
): Promise<UserDevice | null> {
  const { rows } = await q.query<DeviceRow>(
    `UPDATE user_devices
        SET revoked_at = NOW(), revoked_by = $3
      WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL
      RETURNING *`,
    [deviceId, tenantId, revokedBy],
  );
  return rows[0] ? mapDevice(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// device_pairings
// ---------------------------------------------------------------------------

export async function insertPairingCode(
  q: Queryable,
  input: {
    tenantId: string;
    userId: string;
    outletId: string;
    codeHash: string;
    createdBy: string;
    expiresAt: Date;
  },
): Promise<{ id: string }> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO device_pairings
       (tenant_id, user_id, outlet_id, code_hash, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.tenantId,
      input.userId,
      input.outletId,
      input.codeHash,
      input.createdBy,
      input.expiresAt,
    ],
  );
  return rows[0]!;
}

export interface PairingLookupRow {
  id: string;
  tenant_id: string;
  user_id: string;
  outlet_id: string;
  expires_at: Date;
  consumed_at: Date | null;
}

/** Find an unconsumed, unexpired pairing by code hash. The partial index on
 *  (code_hash) WHERE consumed_at IS NULL means this is O(log N) even with a
 *  million historical rows. */
export async function findActivePairing(
  q: Queryable,
  codeHash: string,
): Promise<PairingLookupRow | null> {
  const { rows } = await q.query<PairingLookupRow>(
    `SELECT id, tenant_id, user_id, outlet_id, expires_at, consumed_at
       FROM device_pairings
      WHERE code_hash = $1 AND consumed_at IS NULL
      LIMIT 1`,
    [codeHash],
  );
  return rows[0] ?? null;
}

/** Consume a pairing atomically. The UPDATE ... WHERE consumed_at IS NULL
 *  race-guards double-consumption: two concurrent /pair calls with the same
 *  code will see exactly one UPDATE return a row. */
export async function consumePairing(
  q: Queryable,
  pairingId: string,
  deviceId: string,
): Promise<boolean> {
  const res = await q.query(
    `UPDATE device_pairings
        SET consumed_at = NOW(), consumed_device_id = $2
      WHERE id = $1 AND consumed_at IS NULL`,
    [pairingId, deviceId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Used by the admin to check a user exists and belongs to actor.tenantId
 *  before generating a pairing. Also returns the user's home outlet so the
 *  device gets scoped to the same outlet. */
export async function findUserForPairing(
  q: Queryable,
  tenantId: string,
  userId: string,
): Promise<{
  id: string;
  tenantId: string;
  outletId: string;
  role: 'admin' | 'manager' | 'staff' | 'kitchen';
  isActive: boolean;
} | null> {
  const { rows } = await q.query<{
    id: string;
    tenant_id: string;
    outlet_id: string;
    role: 'admin' | 'manager' | 'staff' | 'kitchen';
    is_active: boolean;
  }>(
    `SELECT id, tenant_id, outlet_id, role, is_active
       FROM users
      WHERE id = $1 AND tenant_id = $2
      LIMIT 1`,
    [userId, tenantId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    tenantId: r.tenant_id,
    outletId: r.outlet_id,
    role: r.role,
    isActive: r.is_active,
  };
}
