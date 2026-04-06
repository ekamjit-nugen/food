import { pool, withTransaction } from '../../db/index.js';
import type { AuthContext } from '../../middleware/auth.js';
import { writeAudit } from '../../middleware/audit.js';
import { AppError, BadRequest, Conflict, ErrorCode, NotFound } from '../../utils/errors.js';
import { hashPassword, revokeAllRefreshTokens } from '../auth/auth.service.js';
import { updatePasswordHash } from '../auth/auth.repository.js';
import type { PublicUser } from '../auth/auth.types.js';
import * as repo from './users.repository.js';
import type {
  CreateUserInput,
  ListUsersQueryInput,
  ResetPasswordInput,
  UpdateUserInput,
} from './users.schemas.js';

/**
 * User management service.
 *
 * Invariants this layer enforces (not the schema layer, not the DB):
 *
 *   1. Email uniqueness per outlet — the DB enforces this too, but we catch
 *      the conflict and return a clean 409 rather than letting the raw
 *      Postgres error bubble up.
 *   2. Last-admin lockout — we refuse any mutation that would leave the
 *      outlet with zero active admins. Without this guard, a tired admin
 *      can demote themselves at the end of a shift and nobody can log in
 *      the next morning.
 *   3. Self-deactivation — an admin cannot deactivate themselves in a
 *      single call. They can demote-then-log-in-as-someone-else, but the
 *      common foot-gun of clicking "disable" on your own row is blocked.
 *   4. Audit — every mutation writes an audit row. Creates carry the whole
 *      row in `after`; updates carry before + after; password resets carry
 *      an action marker but never the hash or the plaintext.
 */

interface Meta {
  requestId?: string;
  ipAddress?: string;
}

export async function listUsers(
  actor: AuthContext,
  query: ListUsersQueryInput,
): Promise<PublicUser[]> {
  return repo.listUsers(pool, actor.outletId, {
    role: query.role,
    includeInactive: query.includeInactive,
  });
}

export async function getUser(actor: AuthContext, id: string): Promise<PublicUser> {
  const user = await repo.findById(pool, actor.outletId, id);
  if (!user) throw NotFound('user', id);
  return user;
}

export async function createUser(
  actor: AuthContext,
  input: CreateUserInput,
  meta: Meta,
): Promise<PublicUser> {
  // Pre-check for a friendlier error than the raw unique-violation.
  if (await repo.emailExistsInOutlet(pool, actor.outletId, input.email)) {
    throw new AppError({ statusCode: 409, code: ErrorCode.EMAIL_ALREADY_EXISTS, message: `An account with this email already exists` });
  }
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (tx) => {
    // Re-check inside the transaction to close the TOCTOU gap with the
    // pre-check above. The DB unique constraint is the real guard — this
    // is belt-and-suspenders for a clean error message.
    if (await repo.emailExistsInOutlet(tx, actor.outletId, input.email)) {
      throw new AppError({ statusCode: 409, code: ErrorCode.EMAIL_ALREADY_EXISTS, message: `An account with this email already exists` });
    }
    const user = await repo.insertUser(tx, {
      tenantId: actor.tenantId,
      outletId: actor.outletId,
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      role: input.role,
    });
    await writeAudit(tx, {
      actor,
      entityType: 'user',
      entityId: user.id,
      action: 'create',
      after: user,
      ...meta,
    });
    return user;
  });
}

export async function updateUser(
  actor: AuthContext,
  id: string,
  input: UpdateUserInput,
  meta: Meta,
): Promise<PublicUser> {
  return withTransaction(async (tx) => {
    const before = await repo.findById(tx, actor.outletId, id);
    if (!before) throw NotFound('user', id);

    const demotingFromAdmin = input.role !== undefined && before.role === 'admin' && input.role !== 'admin';
    const deactivating = input.isActive === false && before.isActive === true;

    // Self-deactivation guard. Demoting yourself from admin is allowed (a
    // founder who hires a GM might legitimately want to become a manager)
    // but locking yourself out is not.
    if (deactivating && id === actor.userId) {
      throw BadRequest('cannot deactivate yourself');
    }

    // Last-admin guard. Only relevant when we're touching admin-ness.
    if (demotingFromAdmin || (deactivating && before.role === 'admin')) {
      const activeAdmins = await repo.countActiveAdmins(tx, actor.outletId);
      if (activeAdmins <= 1) {
        throw BadRequest(
          'cannot remove the last active admin; promote another user first',
        );
      }
    }

    const after = await repo.updateUser(tx, actor.outletId, id, input);
    if (!after) throw NotFound('user', id); // should be impossible after the before check

    // On deactivation, revoke all refresh tokens so the user is immediately
    // signed out everywhere. Also revoke paired devices.
    if (deactivating) {
      await revokeAllRefreshTokens(tx, id, 'user_deactivated');
      await tx.query(
        `UPDATE user_devices SET revoked_at = NOW(), revoked_by = $2
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [id, actor.userId],
      );
    }

    await writeAudit(tx, {
      actor,
      entityType: 'user',
      entityId: id,
      action: 'update',
      before,
      after,
      ...meta,
    });
    return after;
  });
}

export async function resetPassword(
  actor: AuthContext,
  id: string,
  input: ResetPasswordInput,
  meta: Meta,
): Promise<void> {
  const user = await repo.findById(pool, actor.outletId, id);
  if (!user) throw NotFound('user', id);

  const newHash = await hashPassword(input.newPassword);

  await withTransaction(async (tx) => {
    await updatePasswordHash(tx, id, newHash);
    // Deliberately do NOT include the hash, the old hash, or the plaintext
    // in the audit entry. Just the fact that a reset happened and by whom.
    await writeAudit(tx, {
      actor,
      entityType: 'user',
      entityId: id,
      action: 'update',
      after: { passwordReset: true },
      ...meta,
    });
  });
}
