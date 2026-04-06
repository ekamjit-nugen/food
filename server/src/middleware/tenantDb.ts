import type { Request, Response, NextFunction } from 'express';
import { runWithTenantContext, type TenantContextOptions } from '../db/index.js';

/**
 * Per-request DB context middleware. Installs the tenant session variable
 * that the Postgres RLS policies gate on, so every query made through the
 * shared `pool` during this request is storage-layer-scoped to the caller's
 * tenant in addition to the application-layer WHERE-clause discipline.
 *
 * Must run AFTER requireAuth — it depends on `req.auth.tenantId`. Requests
 * that arrive without auth (signup, public health, anonymous device pairing
 * consume, etc.) pass straight through and run without a tenant context,
 * which the RLS policies treat as a trusted/unconstrained path.
 *
 * How it works:
 *   1. runWithTenantContext checks out a dedicated PoolClient, sets
 *      `app.current_tenant_id` as a session GUC, and runs the downstream
 *      middleware chain inside an AsyncLocalStorage scope that reroutes
 *      pool.query onto that client.
 *   2. Each query still runs as its own autocommit statement — there is
 *      no outer transaction. An earlier revision wrapped the whole request
 *      in BEGIN/COMMIT and got bitten by failing queries aborting the
 *      transaction and turning intended 404/400 responses into 500s.
 *   3. The Promise resolves when `res` emits `finish` (or `close`). At
 *      that point the client's GUCs are RESET and it returns to the pool.
 */
function runRequestInDbContext(
  req: Request,
  res: Response,
  next: NextFunction,
  opts: TenantContextOptions,
): void {
  runWithTenantContext(opts, () => {
    return new Promise<void>((resolve) => {
      let released = false;
      const done = () => {
        if (released) return;
        released = true;
        resolve();
      };
      res.once('finish', done);
      res.once('close', done);
      next();
    });
  }).catch((err) => {
    if (!res.headersSent) {
      next(err);
    } else {
      req.log?.error?.({ err }, 'tenantDb: post-response db error');
    }
  });
}

/**
 * For tenant-authenticated requests. Call after requireAuth has populated
 * req.auth.tenantId.
 */
export function tenantDbMiddleware(req: Request, res: Response, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) {
    next();
    return;
  }
  runRequestInDbContext(req, res, next, { tenantId: auth.tenantId });
}

/**
 * For platform-admin requests. Sets `app.is_platform='on'` so the RLS
 * policies permit cross-tenant reads/writes for /api/v1/platform endpoints.
 * Call after requirePlatformAuth.
 */
export function platformDbMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.platformAuth) {
    next();
    return;
  }
  runRequestInDbContext(req, res, next, { isPlatform: true });
}
