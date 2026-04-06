import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool } from '../../db/index.js';
import { Unauthorized } from '../../utils/errors.js';
import { suspendTenant, unsuspendTenant } from '../../utils/tenant-gate.js';
import { kickTenant } from '../../ws/kds.js';
import { hashPassword, verifyPassword, revokeAllTenantRefreshTokens } from '../auth/auth.service.js';
import * as repo from './platform.repository.js';
import type {
  PlatformAuthContext,
  PlatformLoginResult,
  PlatformStats,
  PlatformTenantDetail,
  PlatformTenantSummary,
  PlatformTokenPayload,
  PlatformUser,
  TenantStatus,
} from './platform.types.js';

/**
 * Platform super-admin service.
 *
 * The JWTs issued here carry `aud: 'platform'`. The requirePlatformAuth
 * middleware enforces that audience, and conversely the tenant
 * requireAuth middleware will later be updated to enforce `aud: 'tenant'`
 * (or absent, for backward compat with already-issued tenant tokens).
 *
 * This is the second, mutually-exclusive auth pool. A platform admin
 * cannot take actions as a tenant user and vice versa — they must log in
 * twice to do both, which is exactly the boundary we want.
 */

export const PlatformLoginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1).max(128),
  })
  .strict();
export type PlatformLoginInput = z.infer<typeof PlatformLoginSchema>;

/**
 * PATCH /platform/tenants/:id body: change tenant status.
 * Only status transitions are exposed today — name/plan edits would need
 * tenant-side invalidations we haven't built yet.
 */
export const UpdateTenantStatusSchema = z
  .object({
    status: z.enum(['trial', 'active', 'suspended', 'cancelled']),
  })
  .strict();
export type UpdateTenantStatusInput = z.infer<typeof UpdateTenantStatusSchema>;

export const TenantIdParamSchema = z.object({ id: z.string().uuid() });

function signPlatformToken(payload: PlatformTokenPayload): { token: string; expiresIn: string } {
  const token = jwt.sign(
    { email: payload.email },
    env.JWT_SECRET,
    {
      subject: payload.sub,
      audience: 'platform',
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    },
  );
  return { token, expiresIn: env.JWT_EXPIRES_IN };
}

/**
 * Verify a platform JWT. Throws Unauthorized on any failure. Used by the
 * requirePlatformAuth middleware. We check the audience explicitly so a
 * tenant token cannot reach a platform route even if the signature is
 * valid (both pools share the same JWT_SECRET by design — separate pools
 * would mean separate secrets to rotate and that is not worth the
 * operational cost today).
 */
export function verifyPlatformToken(token: string): PlatformAuthContext {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { audience: 'platform', clockTolerance: 30 }) as jwt.JwtPayload;
  } catch {
    throw Unauthorized('invalid or expired platform token');
  }
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw Unauthorized('malformed platform token payload');
  }
  return { userId: payload.sub, email: payload.email };
}

/**
 * Platform login. Same constant-time shape as tenant login — we always
 * run bcrypt against a real-cost hash so timing doesn't leak which
 * emails exist.
 */
export async function login(input: PlatformLoginInput): Promise<PlatformLoginResult> {
  const user = await repo.findByEmail(pool, input.email);
  const hashForCompare = user?.passwordHash ?? DUMMY_HASH;
  const ok = await verifyPassword(input.password, hashForCompare);

  if (!user || !ok) {
    throw Unauthorized('invalid email or password');
  }
  if (!user.isActive) {
    throw Unauthorized('account disabled');
  }

  await repo.touchLastLogin(pool, user.id);

  const publicUser: PlatformUser = repo.toPublic(user);
  const { token, expiresIn } = signPlatformToken({ sub: user.id, email: user.email });
  return { token, expiresIn, user: publicUser };
}

// ---------------------------------------------------------------------------
// Tenant directory (platform console)
// ---------------------------------------------------------------------------

export async function listTenants(): Promise<PlatformTenantSummary[]> {
  return repo.listTenants(pool);
}

export async function getStats(): Promise<PlatformStats> {
  return repo.getStats(pool);
}

export async function getTenant(id: string): Promise<PlatformTenantDetail | null> {
  return repo.getTenantDetail(pool, id);
}

export async function updateTenantStatus(
  id: string,
  status: TenantStatus,
): Promise<PlatformTenantSummary | null> {
  const result = await repo.updateTenantStatus(pool, id, status);
  if (!result) return null;

  // Sync the in-memory tenant gate so the auth middleware starts rejecting
  // requests immediately, and kick any live WebSocket sessions.
  if (status === 'suspended' || status === 'cancelled') {
    suspendTenant(id);
    kickTenant(id);
    // Revoke all refresh tokens so suspended tenants can't silently refresh
    await revokeAllTenantRefreshTokens(pool, id, `tenant_${status}`);
  } else {
    // trial or active — remove from the gate
    unsuspendTenant(id);
  }

  return result;
}

/**
 * Create a platform admin. This is NOT exposed via an HTTP endpoint — it
 * is only reachable via the CLI bootstrap script. Self-serve platform
 * admin signup would be a privilege-escalation catastrophe.
 */
export async function createPlatformAdmin(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<PlatformUser> {
  const passwordHash = await hashPassword(input.password);
  const row = await repo.insert(pool, {
    email: input.email,
    passwordHash,
    fullName: input.fullName,
  });
  return repo.toPublic(row);
}

/**
 * Dummy bcrypt hash for constant-time login against unknown emails.
 * Matches the tenant auth service's pattern; see comments there.
 */
const DUMMY_HASH = bcrypt.hashSync(
  'not-a-real-platform-password-' + Math.random(),
  12,
);
