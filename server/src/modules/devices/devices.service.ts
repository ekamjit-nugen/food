import bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { pool, withTransaction } from '../../db/index.js';
import type { AuthContext } from '../../middleware/auth.js';
import { writeAudit } from '../../middleware/audit.js';
import {
  BadRequest,
  Forbidden,
  NotFound,
  Unauthorized,
} from '../../utils/errors.js';
import * as authRepo from '../auth/auth.repository.js';
import { signToken, createRefreshToken } from '../auth/auth.service.js';
import type { LoginResult } from '../auth/auth.types.js';
import * as repo from './devices.repository.js';
import type {
  ConsumePairingInput,
  DeviceLoginInput,
} from './devices.schemas.js';
import type { PairingCodeIssued, UserDevice } from './devices.types.js';

/**
 * Device pairing service.
 *
 * Security model:
 *   - Pairing codes: 8 random alphanumeric chars, SHA-256 hashed at rest,
 *     10-minute TTL, single-use. The raw code leaves the server exactly
 *     once — in the 201 response to the admin who issued it.
 *   - Device tokens: `<deviceId>.<secret>` where secret is 32 bytes of
 *     base64url entropy. The secret is bcrypt-hashed at rest; the deviceId
 *     is a plain UUID so lookups are O(1). Losing the DB dump does not
 *     yield device impersonation; losing a phone does, which is why we
 *     expose a revoke button to admins.
 *   - Cross-tenant: every mutation rechecks tenant_id. An admin in tenant A
 *     cannot pair, list, or revoke devices in tenant B even if they guess
 *     UUIDs — the WHERE clauses always filter on actor.tenantId.
 *
 * Rate limiting lives at the route layer (devices.routes.ts) — consume and
 * device-login are brute-forceable and must be capped per IP.
 */

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1
const DEVICE_SECRET_BYTES = 32;
const BCRYPT_ROUNDS = 12;

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function generatePairingCode(): string {
  // 8 chars from a 32-char alphabet → 40 bits of entropy. Combined with a
  // 10-minute TTL and rate-limited consume endpoint, this resists online
  // guessing with comfortable margin. Unambiguous alphabet so staff can
  // read it aloud if a QR fails to scan.
  let out = '';
  for (let i = 0; i < 8; i += 1) {
    out += PAIRING_CODE_ALPHABET[randomInt(0, PAIRING_CODE_ALPHABET.length)];
  }
  return out;
}

function buildQrPayload(code: string): string {
  // v1: the mobile app recognises this shape. We include a version so we can
  // evolve the payload (e.g. embed the API base URL for multi-env installs)
  // without breaking old app builds.
  return JSON.stringify({ v: 1, kind: 'food.pair', code });
}

// ---------------------------------------------------------------------------
// Admin: create a pairing code
// ---------------------------------------------------------------------------

/**
 * Create a pairing code for a target user in the actor's tenant. Authorised
 * to tenant owners, admins, and managers — the same set who can invite or
 * reset passwords. A staff member cannot self-issue a pairing code; the
 * admin has to click "Pair device" on their behalf. This matches the physical
 * workflow (staff hands their phone to a manager at shift start).
 */
export async function createPairingCode(
  actor: AuthContext,
  targetUserId: string,
  meta: { requestId?: string; ipAddress?: string } = {},
): Promise<PairingCodeIssued> {
  if (!actor.isTenantOwner && actor.role !== 'admin' && actor.role !== 'manager') {
    throw Forbidden('only tenant owners, admins, or managers can pair devices');
  }

  const target = await repo.findUserForPairing(pool, actor.tenantId, targetUserId);
  if (!target) throw NotFound('user');
  if (!target.isActive) throw BadRequest('user is inactive');

  const code = generatePairingCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

  await repo.insertPairingCode(pool, {
    tenantId: actor.tenantId,
    userId: target.id,
    outletId: target.outletId,
    codeHash,
    createdBy: actor.userId,
    expiresAt,
  });

  await writeAudit(pool, {
    actor,
    entityType: 'device_pairing',
    entityId: target.id,
    action: 'create',
    // Never log the raw code or even its hash — auditors can see that a
    // pairing was issued, not which one.
    after: { event: 'pairing_code_issued', targetUserId: target.id, expiresAt },
    ...meta,
  });

  return { code, qrPayload: buildQrPayload(code), expiresAt };
}

// ---------------------------------------------------------------------------
// Mobile app: consume a pairing code → receive device token
// ---------------------------------------------------------------------------

/**
 * Redeem a pairing code for a long-lived device token. Anonymous endpoint —
 * the code itself is the authorization. Guarded by:
 *   - rate limiting at the route layer (per IP)
 *   - 10-minute TTL
 *   - single-use (atomic UPDATE ... WHERE consumed_at IS NULL)
 *   - bcrypt-hashed device secret at rest
 *
 * Returns both the token and the device metadata the app will display in
 * its settings screen (label, outlet name, last paired).
 */
export async function consumePairingCode(
  input: ConsumePairingInput,
  meta: { ipAddress?: string } = {},
): Promise<{ deviceToken: string; device: UserDevice }> {
  const codeHash = hashCode(input.code);
  const now = Date.now();

  // Two-step: fetch candidate, then atomically consume. We do this in a
  // transaction so the fetch and the UPDATE see consistent state.
  return withTransaction(async (tx) => {
    const pairing = await repo.findActivePairing(tx, codeHash);
    if (!pairing) throw Unauthorized('invalid or expired pairing code');
    if (pairing.expires_at.getTime() < now) {
      throw Unauthorized('invalid or expired pairing code');
    }

    // Generate the device secret BEFORE we insert the device row so we can
    // store bcrypt(secret) in the same INSERT. The raw secret only ever
    // exists in this function's scope.
    const secret = randomBytes(DEVICE_SECRET_BYTES).toString('base64url');
    const tokenHash = await bcrypt.hash(secret, BCRYPT_ROUNDS);

    const device = await repo.insertDevice(tx, {
      tenantId: pairing.tenant_id,
      userId: pairing.user_id,
      outletId: pairing.outlet_id,
      label: input.label,
      platform: input.platform ?? null,
      tokenHash,
      firstSeenIp: meta.ipAddress ?? null,
    });

    const consumed = await repo.consumePairing(tx, pairing.id, device.id);
    if (!consumed) {
      // Lost the race against a concurrent consume. The insertDevice above
      // will be rolled back by the thrown error. Treat as invalid code.
      throw Unauthorized('invalid or expired pairing code');
    }

    // Audit the bind. Actor is the paired user (best we can attribute —
    // there is no admin in this request). The fact that a device was
    // successfully paired for this user is what matters for review.
    await writeAudit(tx, {
      actor: {
        userId: pairing.user_id,
        tenantId: pairing.tenant_id,
        outletId: pairing.outlet_id,
        isTenantOwner: false,
        email: 'device-pair',
        role: 'staff',
      },
      entityType: 'user_device',
      entityId: device.id,
      action: 'create',
      after: {
        event: 'device_paired',
        label: device.label,
        platform: device.platform,
        ipAddress: meta.ipAddress,
      },
    });

    const deviceToken = `${device.id}.${secret}`;
    return { deviceToken, device };
  });
}

// ---------------------------------------------------------------------------
// Mobile app: exchange device token for a tenant JWT
// ---------------------------------------------------------------------------

/**
 * Device login. The mobile app calls this on every cold start and whenever
 * the in-memory tenant JWT is about to expire. Returns the same LoginResult
 * shape as /auth/login so the app's auth layer is uniform.
 *
 * Revocation: if the device row is revoked (admin clicked the button), the
 * initial findDeviceForLogin returns null and the app sees a 401. The app
 * handles 401 by clearing its stored device token and bouncing back to the
 * pairing screen. There is no way to "un-revoke" a device — a revoked
 * device has to pair again.
 */
export async function deviceLogin(
  input: DeviceLoginInput,
  meta: { ipAddress?: string } = {},
): Promise<LoginResult> {
  const [deviceId, secret, ...rest] = input.deviceToken.split('.');
  if (!deviceId || !secret || rest.length > 0) {
    throw Unauthorized('invalid device token');
  }

  const device = await repo.findDeviceForLogin(pool, deviceId);
  if (!device) throw Unauthorized('invalid device token');

  const ok = await bcrypt.compare(secret, device.tokenHash);
  if (!ok) throw Unauthorized('invalid device token');

  // Re-load the user so we pick up any role/outlet changes since pairing.
  // findUserById is scoped by outletId, which is fine because the device is
  // bound to a specific outlet — if the user has moved outlets, the old
  // device should not grant access to the new one without re-pairing.
  const user = await authRepo.findUserById(pool, device.outletId, device.userId);
  if (!user) throw Unauthorized('user no longer exists');
  if (!user.isActive) throw Unauthorized('user is inactive');

  await repo.touchDeviceLastSeen(pool, device.id, meta.ipAddress ?? null);

  const { token, expiresIn } = signToken({
    sub: user.id,
    tenantId: user.tenantId,
    outletId: user.outletId,
    isTenantOwner: user.isTenantOwner,
    email: user.email,
    role: user.role,
  });

  const { refreshToken } = await createRefreshToken(pool, user.id, user.tenantId);
  return { token, expiresIn, user: authRepo.toPublicUser(user), refreshToken };
}

// ---------------------------------------------------------------------------
// Admin: list / revoke devices
// ---------------------------------------------------------------------------

export async function listDevices(
  actor: AuthContext,
  targetUserId: string,
): Promise<UserDevice[]> {
  if (!actor.isTenantOwner && actor.role !== 'admin' && actor.role !== 'manager') {
    throw Forbidden('only tenant owners, admins, or managers can list devices');
  }
  // Cross-tenant guard: the target must belong to the actor's tenant.
  const target = await repo.findUserForPairing(pool, actor.tenantId, targetUserId);
  if (!target) throw NotFound('user');
  return repo.listDevicesForUser(pool, actor.tenantId, targetUserId);
}

export async function revokeDevice(
  actor: AuthContext,
  deviceId: string,
  meta: { requestId?: string; ipAddress?: string } = {},
): Promise<UserDevice> {
  if (!actor.isTenantOwner && actor.role !== 'admin' && actor.role !== 'manager') {
    throw Forbidden('only tenant owners, admins, or managers can revoke devices');
  }
  const updated = await repo.revokeDevice(pool, actor.tenantId, deviceId, actor.userId);
  if (!updated) throw NotFound('device');

  await writeAudit(pool, {
    actor,
    entityType: 'user_device',
    entityId: deviceId,
    action: 'update',
    after: { event: 'device_revoked', deviceUserId: updated.userId },
    ...meta,
  });

  return updated;
}
