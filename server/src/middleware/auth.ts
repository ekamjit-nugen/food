import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../db/index.js';
import { tenantDbMiddleware, platformDbMiddleware } from './tenantDb.js';
import { AppError, ErrorCode, Unauthorized, Forbidden } from '../utils/errors.js';
import { isTenantSuspended } from '../utils/tenant-gate.js';

export interface AuthContext {
  userId: string;
  tenantId: string;
  outletId: string;
  isTenantOwner: boolean;
  email: string;
  role: 'admin' | 'manager' | 'staff' | 'kitchen';
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
    platformAuth?: { userId: string; email: string };
  }
}

/**
 * Require a valid JWT. Populates req.auth with the user + tenant + current
 * outlet context.
 *
 * Outlet resolution:
 *   - The JWT carries the user's "home" outlet (set at login). By default
 *     that is the outlet used for the request, so existing single-outlet
 *     flows continue to work unchanged.
 *   - A client MAY send an `X-Outlet-Id` header to act on a different outlet
 *     within the same tenant. We validate, for every request, that:
 *       1. The target outlet belongs to the user's tenant (rule 1 — immutable
 *          tenant ownership; outlets never migrate between tenants).
 *       2. The user is the tenant owner OR has a row in user_outlet_access
 *          for that outlet. Tenant owners have implicit access to all outlets
 *          in their tenant (project decision #7).
 *   - Cross-tenant outlet ids are rejected as Forbidden — not NotFound — so
 *     an attacker probing for valid outlet UUIDs can't use the error shape to
 *     enumerate tenants.
 *
 * The DB round-trip for X-Outlet-Id is cheap (a single indexed lookup) and
 * only fires when the header is present. Home-outlet requests keep the fast
 * path and hit no DB here.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return next(Unauthorized('missing bearer token'));
  }
  const token = header.slice('Bearer '.length);
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { clockTolerance: 30 }) as jwt.JwtPayload;
  } catch (jwtErr) {
    const isExpired = jwtErr instanceof Error && jwtErr.name === 'TokenExpiredError';
    return next(
      new AppError({
        statusCode: 401,
        code: isExpired ? ErrorCode.TOKEN_EXPIRED : ErrorCode.UNAUTHORIZED,
        message: isExpired
          ? 'Your session has expired. Please sign in again.'
          : 'Invalid or expired token',
      }),
    );
  }
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.tenantId !== 'string' ||
    typeof payload.outletId !== 'string' ||
    typeof payload.email !== 'string' ||
    typeof payload.role !== 'string' ||
    typeof payload.isTenantOwner !== 'boolean'
  ) {
    return next(Unauthorized('malformed token payload'));
  }

  const tenantId = payload.tenantId;
  const isTenantOwner = payload.isTenantOwner;
  const userId = payload.sub;
  let outletId = payload.outletId;

  // Fast in-memory gate: reject requests for suspended/cancelled tenants.
  // This is O(1) — no DB round-trip. The set is primed at startup and
  // updated when the platform admin changes a tenant's status.
  if (isTenantSuspended(tenantId)) {
    return next(
      new AppError({
        statusCode: 403,
        code: ErrorCode.TENANT_SUSPENDED,
        message: 'This workspace has been suspended. Contact support.',
      }),
    );
  }

  const headerOutlet = req.header('x-outlet-id');
  if (headerOutlet && headerOutlet !== outletId) {
    // Shape-guard the header so a garbage value can't trigger a UUID cast
    // error deep in a query. 36-char UUID, or we reject up front.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headerOutlet)) {
      return next(Forbidden('invalid outlet context'));
    }
    try {
      // Single query that answers both questions:
      //   1. Does the outlet belong to this tenant?
      //   2. Does this user have access (owner → always; else user_outlet_access)?
      // If either fails we return Forbidden with a generic message.
      const { rows } = await pool.query<{ allowed: boolean }>(
        `SELECT CASE
                  WHEN o.tenant_id <> $2 THEN FALSE
                  WHEN $4::boolean THEN TRUE
                  WHEN EXISTS (
                    SELECT 1 FROM user_outlet_access
                     WHERE user_id = $3 AND outlet_id = o.id
                  ) THEN TRUE
                  ELSE FALSE
                END AS allowed
           FROM outlets o
          WHERE o.id = $1
          LIMIT 1`,
        [headerOutlet, tenantId, userId, isTenantOwner],
      );
      if (!rows[0] || rows[0].allowed !== true) {
        return next(Forbidden('outlet not accessible'));
      }
      outletId = headerOutlet;
    } catch (err) {
      return next(err);
    }
  }

  req.auth = {
    userId,
    tenantId,
    outletId,
    isTenantOwner,
    email: payload.email,
    role: payload.role as AuthContext['role'],
  };
  // Hand off to the tenant-DB middleware so the rest of the request runs
  // inside an RLS-scoped Postgres transaction. Every query made through the
  // shared `pool` will be storage-layer restricted to this tenant, in
  // addition to whatever WHERE-clause filtering the repositories do.
  return tenantDbMiddleware(req, res, next);
}

/**
 * Require a valid platform super-admin JWT (aud: 'platform'). Populates
 * req.platformAuth. A tenant JWT will be rejected here because the
 * audience check fails — tenant tokens are signed without the 'platform'
 * audience, so verifyPlatformToken's `audience: 'platform'` option throws.
 *
 * Import lives inside the function to avoid a circular dep between the
 * middleware barrel and modules/platform.
 */
export async function requirePlatformAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return next(Unauthorized('missing bearer token'));
  }
  const token = header.slice('Bearer '.length);
  try {
    const { verifyPlatformToken } = await import('../modules/platform/platform.service.js');
    req.platformAuth = verifyPlatformToken(token);
    // Platform admins run under `app.is_platform='on'` so RLS permits
    // cross-tenant reads and writes.
    return platformDbMiddleware(req, res, next);
  } catch (err) {
    return next(err);
  }
}

/**
 * Require one of the given roles. Use after requireAuth.
 */
export function requireRole(...roles: AuthContext['role'][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(Unauthorized());
    if (!roles.includes(req.auth.role)) {
      return next(Forbidden(`requires role: ${roles.join(', ')}`));
    }
    return next();
  };
}
