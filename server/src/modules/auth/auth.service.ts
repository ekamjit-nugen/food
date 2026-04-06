import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { pool, withTransaction } from '../../db/index.js';
import type { AuthContext } from '../../middleware/auth.js';
import { writeAudit } from '../../middleware/audit.js';
import { AppError, BadRequest, Conflict, ErrorCode, Forbidden, NotFound, Unauthorized } from '../../utils/errors.js';
import * as repo from './auth.repository.js';
import type {
  LoginInput,
  ChangePasswordInput,
  SignupInput,
  InviteStaffInput,
  AcceptInviteInput,
} from './auth.schemas.js';
import type { LoginResult, PublicUser, TokenPayload } from './auth.types.js';

/**
 * Auth service.
 *
 * Password storage: bcrypt, cost factor 12. That's ~300ms on a modern
 * laptop — slow enough to make online brute-forcing painful, fast enough
 * that login isn't a user complaint. Do not tune it down.
 *
 * Token strategy: stateless JWT, no refresh tokens in v1. Tokens expire
 * per env.JWT_EXPIRES_IN. When we need revocation, we will add a token
 * version column on users and include it in the claim. Do not reach for
 * refresh tokens until the product actually demands them — they are a
 * giant footgun that most single-tenant tools do not need.
 */

const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * Timing-safe wrapper around bcrypt.compare.
 * Returns false for any invalid hash format instead of throwing — login
 * paths should never leak "hash parse error" vs "password mismatch".
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Role-based access token TTLs. Staff and kitchen roles work 8-12h shifts
 * and should never be interrupted by a login prompt. Admin/manager tokens
 * are shorter to limit the blast radius of a leaked token.
 */
function accessTokenTtl(role: string): string {
  return role === 'staff' || role === 'kitchen' ? '12h' : '2h';
}

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function signToken(payload: TokenPayload): { token: string; expiresIn: string } {
  const expiresIn = accessTokenTtl(payload.role);
  const token = jwt.sign(
    {
      tenantId: payload.tenantId,
      outletId: payload.outletId,
      isTenantOwner: payload.isTenantOwner,
      email: payload.email,
      role: payload.role,
    },
    env.JWT_SECRET,
    {
      subject: payload.sub,
      expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
    },
  );
  return { token, expiresIn };
}

/**
 * Create a refresh token. Returns the raw token (to be sent to the client)
 * and stores the sha256 hash in the database.
 */
export async function createRefreshToken(
  db: import('../../db/index.js').Queryable,
  userId: string,
  tenantId: string,
): Promise<{ refreshToken: string; refreshExpiresAt: Date }> {
  const raw = randomBytes(32).toString('base64url');
  const hash = (await import('node:crypto')).createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  await db.query(
    `INSERT INTO refresh_tokens (token_hash, user_id, tenant_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [hash, userId, tenantId, expiresAt],
  );
  return { refreshToken: raw, refreshExpiresAt: expiresAt };
}

/**
 * Rotate a refresh token: validate the old one, revoke it, issue a new pair.
 */
export async function refreshSession(
  rawToken: string,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: string; user: PublicUser }> {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(rawToken).digest('hex');

  return withTransaction(async (tx) => {
    // Find and lock the token row
    const { rows } = await tx.query<{
      id: string;
      user_id: string;
      tenant_id: string;
      expires_at: Date;
      is_revoked: boolean;
    }>(
      `SELECT id, user_id, tenant_id, expires_at, is_revoked
         FROM refresh_tokens
        WHERE token_hash = $1
        FOR UPDATE`,
      [hash],
    );
    const row = rows[0];
    if (!row || row.is_revoked || row.expires_at.getTime() < Date.now()) {
      throw Unauthorized('refresh token is invalid or expired');
    }

    // Revoke the old token (rotation)
    await tx.query(
      `UPDATE refresh_tokens SET is_revoked = TRUE, revoked_at = NOW(), revoked_reason = 'rotated'
        WHERE id = $1`,
      [row.id],
    );

    // Verify user is still active
    const userRow = await tx.query<{
      id: string; tenant_id: string; outlet_id: string; is_tenant_owner: boolean;
      email: string; full_name: string; role: string; is_active: boolean;
      last_login_at: Date | null; created_at: Date;
    }>(
      `SELECT id, tenant_id, outlet_id, is_tenant_owner, email, full_name, role, is_active, last_login_at, created_at
         FROM users WHERE id = $1`,
      [row.user_id],
    );
    const user = userRow.rows[0];
    if (!user || !user.is_active) {
      throw new AppError({
        statusCode: 403,
        code: ErrorCode.ACCOUNT_DEACTIVATED,
        message: 'Your account has been deactivated. Contact your admin.',
      });
    }

    // Issue new tokens
    const { token: accessToken, expiresIn } = signToken({
      sub: user.id,
      tenantId: user.tenant_id,
      outletId: user.outlet_id,
      isTenantOwner: user.is_tenant_owner,
      email: user.email,
      role: user.role as TokenPayload['role'],
    });

    const { refreshToken } = await createRefreshToken(tx, user.id, user.tenant_id);

    const publicUser: PublicUser = {
      id: user.id,
      tenantId: user.tenant_id,
      outletId: user.outlet_id,
      isTenantOwner: user.is_tenant_owner,
      email: user.email,
      fullName: user.full_name,
      role: user.role as PublicUser['role'],
      isActive: user.is_active,
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at,
    };

    return { accessToken, refreshToken, expiresIn, user: publicUser };
  });
}

/**
 * Revoke all refresh tokens for a user. Called on logout, deactivation,
 * or password change.
 */
export async function revokeAllRefreshTokens(
  db: import('../../db/index.js').Queryable,
  userId: string,
  reason: string,
): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens SET is_revoked = TRUE, revoked_at = NOW(), revoked_reason = $2
      WHERE user_id = $1 AND is_revoked = FALSE`,
    [userId, reason],
  );
}

/**
 * Revoke all refresh tokens for a tenant. Called on suspension.
 */
export async function revokeAllTenantRefreshTokens(
  db: import('../../db/index.js').Queryable,
  tenantId: string,
  reason: string,
): Promise<void> {
  await db.query(
    `UPDATE refresh_tokens SET is_revoked = TRUE, revoked_at = NOW(), revoked_reason = $2
      WHERE tenant_id = $1 AND is_revoked = FALSE`,
    [tenantId, reason],
  );
}

export async function login(input: LoginInput, meta: { ipAddress?: string } = {}): Promise<LoginResult> {
  // Resolve the tenant first. We do NOT early-return on "tenant not found" —
  // instead we still run bcrypt against a dummy hash so timing leaks nothing
  // about which slugs exist vs. which emails exist. A real attacker probing
  // the login endpoint should not be able to distinguish the three failure
  // modes (bad slug, bad email, bad password) from latency alone.
  const tenant = await repo.findActiveTenantBySlug(pool, input.tenantSlug);
  const user =
    tenant && tenant.status === 'active'
      ? await repo.findUserByTenantAndEmail(pool, tenant.id, input.email)
      : null;

  // Constant-ish time: always run bcrypt so that "user exists" and "user
  // does not exist" take similar time. Without this, an attacker can
  // enumerate emails by response latency.
  const hashForCompare = user?.passwordHash ?? DUMMY_HASH;
  const ok = await verifyPassword(input.password, hashForCompare);

  if (!tenant || tenant.status !== 'active' || !user || !ok) {
    throw new AppError({
      statusCode: 401,
      code: ErrorCode.INVALID_CREDENTIALS,
      message: 'Invalid email or password',
    });
  }
  if (!user.isActive) {
    throw new AppError({
      statusCode: 403,
      code: ErrorCode.ACCOUNT_DEACTIVATED,
      message: 'Your account has been deactivated. Contact your admin.',
    });
  }

  await repo.touchLastLogin(pool, user.id);

  const publicUser: PublicUser = repo.toPublicUser(user);
  const { token, expiresIn } = signToken({
    sub: user.id,
    tenantId: user.tenantId,
    outletId: user.outletId,
    isTenantOwner: user.isTenantOwner,
    email: user.email,
    role: user.role,
  });

  const { refreshToken } = await createRefreshToken(pool, user.id, user.tenantId);

  // Audit: we record login as an action on the user entity. Useful both
  // for security review and for "when did this staff member last use the
  // POS" questions.
  await writeAudit(pool, {
    actor: {
      userId: user.id,
      tenantId: user.tenantId,
      outletId: user.outletId,
      isTenantOwner: user.isTenantOwner,
      email: user.email,
      role: user.role,
    },
    entityType: 'user',
    entityId: user.id,
    action: 'update',
    after: { event: 'login', ipAddress: meta.ipAddress },
  });

  return { token, expiresIn, user: publicUser, refreshToken };
}

/**
 * Self-serve tenant signup. Creates the tenant, its first outlet, and a
 * tenant-owner user atomically, then returns a login token so the caller can
 * drop straight into the onboarding UI without a second round-trip.
 *
 * Email verification is deferred (project decision #3 — email sending is
 * stubbed to an outbox table). We mark the tenant active immediately so the
 * first-run UX is not gated on a mail delivery we aren't wiring yet. When
 * real email ships, flip the default status to 'pending' and gate login on
 * verification.
 */
export async function signup(
  input: SignupInput,
  meta: { ipAddress?: string } = {},
): Promise<LoginResult> {
  // Pre-check slug uniqueness for a clean 409 rather than a raw 23505.
  const existing = await repo.findActiveTenantBySlug(pool, input.slug);
  if (existing) {
    throw new AppError({
      statusCode: 409,
      code: ErrorCode.SLUG_ALREADY_TAKEN,
      message: 'This workspace URL is already taken',
    });
  }

  const passwordHash = await hashPassword(input.password);

  const { tenant, owner } = await withTransaction(async (tx) => {
    // Re-check inside the tx to close the TOCTOU window with the pre-check.
    const dup = await repo.findActiveTenantBySlug(tx, input.slug);
    if (dup) throw new AppError({ statusCode: 409, code: ErrorCode.SLUG_ALREADY_TAKEN, message: 'This workspace URL is already taken' });

    const tenant = await repo.insertTenant(tx, {
      name: input.restaurantName,
      slug: input.slug,
      status: 'active',
    });
    const outlet = await repo.insertOutlet(tx, {
      tenantId: tenant.id,
      name: input.firstOutletName,
    });
    const owner = await repo.insertTenantOwner(tx, {
      tenantId: tenant.id,
      outletId: outlet.id,
      email: input.email,
      passwordHash,
      fullName: input.ownerFullName,
    });
    await writeAudit(tx, {
      actor: {
        userId: owner.id,
        tenantId: tenant.id,
        outletId: outlet.id,
        isTenantOwner: true,
        email: owner.email,
        role: owner.role,
      },
      entityType: 'tenant',
      entityId: tenant.id,
      action: 'create',
      after: { event: 'tenant_signup', slug: tenant.slug, name: tenant.name, ipAddress: meta.ipAddress },
    });
    return { tenant, owner };
  });

  const { token, expiresIn } = signToken({
    sub: owner.id,
    tenantId: tenant.id,
    outletId: owner.outletId,
    isTenantOwner: true,
    email: owner.email,
    role: owner.role,
  });
  const { refreshToken } = await createRefreshToken(pool, owner.id, tenant.id);
  return { token, expiresIn, user: repo.toPublicUser(owner), refreshToken };
}

/**
 * Invite a staff member to the actor's tenant.
 *
 * Authorization: the actor must be a tenant owner or a manager. Both can
 * invite users with role in {manager, staff, kitchen}. Owners cannot be
 * created by invite — that route is signup or platform admin tooling.
 *
 * Outlet scoping: the caller picks which outlets the invitee can access.
 * We validate that every outlet id belongs to the actor's tenant before
 * persisting — a manager cannot grant access to an outlet they themselves
 * cannot see, because the filter runs against the tenant, not the actor's
 * user_outlet_access set. This is intentional: managers can invite for any
 * outlet in the tenant, but the invite still cannot escape the tenant
 * boundary (the only boundary that actually matters for data isolation).
 *
 * Email: deferred per project decision #3 — we enqueue a row in
 * email_outbox. The token is returned from this service function ONLY so
 * the controller can log it in dev. In production, the token is sent via
 * email and never returned from the API.
 */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function inviteStaff(
  actor: AuthContext,
  input: InviteStaffInput,
  meta: { requestId?: string; ipAddress?: string } = {},
): Promise<{ token: string; expiresAt: Date }> {
  if (!actor.isTenantOwner && actor.role !== 'manager') {
    throw Forbidden('only tenant owners or managers can invite staff');
  }

  return withTransaction(async (tx) => {
    // Validate outlet ids against the actor's tenant. This is the critical
    // cross-tenant guard — filterOutletsInTenant returns only outlets that
    // belong to actor.tenantId.
    const valid = await repo.filterOutletsInTenant(tx, actor.tenantId, input.outletIds);
    const validSet = new Set(valid);
    const invalid = input.outletIds.filter((id) => !validSet.has(id));
    if (invalid.length > 0) {
      throw BadRequest(`outlet(s) not in your tenant: ${invalid.join(', ')}`);
    }

    // If a user with that email already exists in the tenant, refuse —
    // the admin should toggle their outlet access via the users endpoint,
    // not re-invite.
    const existing = await repo.findUserByTenantAndEmail(tx, actor.tenantId, input.email);
    if (existing) throw new AppError({ statusCode: 409, code: ErrorCode.EMAIL_ALREADY_EXISTS, message: 'An account with this email already exists in this tenant' });

    // 32 bytes of entropy, base64url-encoded → 43 chars. Plenty of entropy
    // to resist online guessing; short enough to fit in an email link.
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = await repo.insertStaffInvite(tx, {
      token,
      tenantId: actor.tenantId,
      email: input.email,
      fullName: input.fullName ?? null,
      invitedBy: actor.userId,
      role: input.role,
      outletIds: valid,
      expiresAt,
    });

    await repo.enqueueEmail(tx, {
      toEmail: input.email,
      template: 'staff_invite',
      payload: {
        tenantId: actor.tenantId,
        inviter: actor.email,
        role: input.role,
        token,
        expiresAt: expiresAt.toISOString(),
      },
    });

    await writeAudit(tx, {
      actor,
      entityType: 'staff_invite',
      entityId: invite.token,
      action: 'create',
      after: { email: input.email, role: input.role, outletIds: valid, expiresAt },
      ...meta,
    });

    return { token, expiresAt };
  });
}

/**
 * Accept a pending staff invite. This is a public endpoint (no auth) —
 * possession of the token is the authorization. We still guard against:
 *   - expired tokens
 *   - already-consumed tokens
 *   - tokens for users that somehow already exist (race on re-invite)
 * On success we create the user, grant user_outlet_access for every outlet
 * in the invite, consume the invite, and return a fresh login JWT.
 */
export async function acceptInvite(
  input: AcceptInviteInput,
  meta: { ipAddress?: string } = {},
): Promise<LoginResult> {
  const passwordHash = await hashPassword(input.password);

  const result = await withTransaction(async (tx) => {
    const invite = await repo.findInviteByToken(tx, input.token);
    if (!invite) throw NotFound('invite');
    if (invite.consumed_at) throw new AppError({ statusCode: 410, code: ErrorCode.INVITE_EXPIRED, message: 'This invite has already been used.' });
    if (invite.expires_at.getTime() < Date.now()) throw new AppError({ statusCode: 410, code: ErrorCode.INVITE_EXPIRED, message: 'This invite has expired. Ask your admin for a new one.' });

    // Defense in depth: if a user already exists under this tenant+email,
    // the invite is stale. Consume it and refuse rather than silently
    // overwriting the existing account.
    const dup = await repo.findUserByTenantAndEmail(tx, invite.tenant_id, invite.email);
    if (dup) {
      await repo.consumeInvite(tx, invite.token);
      throw new AppError({ statusCode: 409, code: ErrorCode.EMAIL_ALREADY_EXISTS, message: 'A user with that email already exists' });
    }

    // The first outlet becomes the user's "home" outlet — its id goes into
    // the JWT. Additional outlets are reachable via user_outlet_access +
    // X-Outlet-Id at request time.
    const homeOutletId = invite.outlet_ids[0]!;
    const users = await tx.query<{
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
    }>(
      `INSERT INTO users (tenant_id, outlet_id, is_tenant_owner, email, password_hash, full_name, role)
       VALUES ($1, $2, FALSE, $3, $4, $5, $6)
       RETURNING id, tenant_id, outlet_id, is_tenant_owner, email, full_name, role, is_active, last_login_at, created_at`,
      [
        invite.tenant_id,
        homeOutletId,
        invite.email,
        passwordHash,
        input.fullName ?? invite.full_name ?? invite.email,
        invite.role,
      ],
    );
    const userRow = users.rows[0]!;

    await repo.grantOutletAccess(
      tx,
      invite.outlet_ids.map((outletId) => ({
        userId: userRow.id,
        outletId,
        role: invite.role,
      })),
    );

    await repo.consumeInvite(tx, invite.token);

    const publicUser: PublicUser = {
      id: userRow.id,
      tenantId: userRow.tenant_id,
      outletId: userRow.outlet_id,
      isTenantOwner: userRow.is_tenant_owner,
      email: userRow.email,
      fullName: userRow.full_name,
      role: userRow.role,
      isActive: userRow.is_active,
      lastLoginAt: userRow.last_login_at,
      createdAt: userRow.created_at,
    };

    await writeAudit(tx, {
      actor: {
        userId: userRow.id,
        tenantId: userRow.tenant_id,
        outletId: userRow.outlet_id,
        isTenantOwner: false,
        email: userRow.email,
        role: userRow.role,
      },
      entityType: 'user',
      entityId: userRow.id,
      action: 'create',
      after: { event: 'invite_accepted', ipAddress: meta.ipAddress },
    });

    return publicUser;
  });

  const { token, expiresIn } = signToken({
    sub: result.id,
    tenantId: result.tenantId,
    outletId: result.outletId,
    isTenantOwner: result.isTenantOwner,
    email: result.email,
    role: result.role,
  });
  const { refreshToken } = await createRefreshToken(pool, result.id, result.tenantId);
  return { token, expiresIn, user: result, refreshToken };
}

export async function getMe(actor: AuthContext): Promise<PublicUser> {
  const u = await repo.findUserById(pool, actor.outletId, actor.userId);
  if (!u || !u.isActive) throw Unauthorized('user no longer active');
  return repo.toPublicUser(u);
}

export async function changePassword(
  actor: AuthContext,
  input: ChangePasswordInput,
  meta: { requestId?: string; ipAddress?: string } = {},
): Promise<void> {
  const user = await repo.findUserById(pool, actor.outletId, actor.userId);
  if (!user) throw Unauthorized();

  const ok = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!ok) throw BadRequest('current password is incorrect');

  const newHash = await hashPassword(input.newPassword);
  await repo.updatePasswordHash(pool, user.id, newHash);

  // Audit change, NEVER log the password or hash.
  await writeAudit(pool, {
    actor,
    entityType: 'user',
    entityId: user.id,
    action: 'update',
    after: { event: 'password_changed' },
    ...meta,
  });
}

/**
 * A pre-computed bcrypt hash of a random value, used to make login timing
 * constant-ish for missing users. Generated once per process.
 *
 * Why not a literal constant: we want the cost factor to match the env's
 * BCRYPT_ROUNDS so the comparison timing matches real hashes.
 */
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-' + Math.random(), BCRYPT_ROUNDS);
