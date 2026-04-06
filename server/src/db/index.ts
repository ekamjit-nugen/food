import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { env } from '../config/env.js';
import { childLogger } from '../utils/logger.js';

const log = childLogger('db');

/**
 * Postgres timestamp handling:
 *   By default, node-postgres parses TIMESTAMPTZ into JS Date. We want that.
 *   But we disable parsing of DATE (type 1082) because YYYY-MM-DD has no
 *   timezone and Date-ifying it causes off-by-one bugs. Keep DATE as string.
 */
pg.types.setTypeParser(1082, (val) => val); // DATE -> string

/**
 * The real pool. Not exported directly — callers go through `pool` below,
 * which is a Proxy that routes through the request-scoped client when one
 * is active (see tenantDb middleware + runWithTenantContext).
 */
const realPool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Per-statement timeout: any single query that runs longer than 30s is
  // cancelled by the server. Prevents runaway reports or accidental
  // full-table scans from holding a connection indefinitely.
  statement_timeout: 30_000,
});

realPool.on('error', (err) => {
  log.error({ err }, 'unexpected pg pool error');
});

// ---------------------------------------------------------------------------
// Request-scoped DB context (RLS glue)
// ---------------------------------------------------------------------------
// AsyncLocalStorage holds the per-request PoolClient for the duration of an
// HTTP request. The tenantDb middleware checks out a client, SET SESSION
// `app.current_tenant_id`, runs the request inside an `als.run(ctx, next)`
// scope, and RESETs + releases on completion.
//
// Why session-level (not transaction-local): the request is NOT wrapped in
// a single outer transaction — that approach was tried and rejected because
// a single failing query (e.g. an invalid UUID cast) aborts the transaction
// and poisons every subsequent query in the request with "current transaction
// is aborted", surfacing 500s where the code expected clean 404/400 handling.
// Session-level GUCs give us RLS enforcement without wrapping.
//
// Every call to `pool.query(...)` (dozens scattered across the repositories)
// is silently rerouted onto this client via the Proxy below, so RLS policies
// see the right tenant without any code changes at the call sites. Outside
// a request — migrate script, seed, tests, background jobs — the ALS store
// is empty and queries go straight to realPool with no session variable set,
// which the RLS policies treat as an unconstrained trusted context.
// ---------------------------------------------------------------------------
interface DbContext {
  client: pg.PoolClient;
}

const als = new AsyncLocalStorage<DbContext>();

/**
 * Get the request-scoped client, if any. Exported for the middleware only.
 */
export function currentDbClient(): pg.PoolClient | null {
  return als.getStore()?.client ?? null;
}

/**
 * Proxy around the real pool. Query calls are routed through the active
 * request client when one exists; everything else (connect, end, on, etc.)
 * passes through to the real pool.
 *
 * The cast is safe — the Proxy preserves the pg.Pool shape — but the
 * downstream type `pg.Pool` assumes direct pool access, so a few callers
 * that do `pool.connect()` still land on realPool.connect(), which is
 * exactly what we want for code paths that explicitly manage their own
 * connection (KDS WS, background workers).
 */
export const pool: pg.Pool = new Proxy(realPool, {
  get(target, prop, _receiver) {
    if (prop === 'query') {
      return function boundQuery(this: unknown, ...args: unknown[]) {
        const client = als.getStore()?.client;
        if (client) {
          return (client.query as (...a: unknown[]) => unknown).apply(client, args);
        }
        return (target.query as (...a: unknown[]) => unknown).apply(target, args);
      };
    }
    // Forward everything else to the real pool with `this` bound correctly.
    // Using Reflect.get with the proxy as receiver would re-enter the get
    // trap and, for methods that rely on internal slots (connect, end,
    // EventEmitter.on), lose the correct `this`. Binding to target sidesteps
    // both issues.
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

/**
 * Run a function inside a transaction. Commits on success, rolls back on
 * any throw. Returns the function's result.
 *
 * When called inside an active request context, the request's own ALS
 * client is reused (it carries the session-level tenant GUCs, so RLS is
 * still enforced). BEGIN/COMMIT still run; express handlers are sequential
 * per request so there is no concurrent use of the client.
 *
 * Outside a request (seed, tests, migrate): acquire a fresh client from the
 * real pool and run a plain BEGIN/COMMIT.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const existing = als.getStore()?.client;
  const client = existing ?? (await realPool.connect());
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      log.error({ rollbackErr }, 'rollback failed');
    }
    throw err;
  } finally {
    if (!existing) client.release();
  }
}

export interface TenantContextOptions {
  tenantId?: string;
  isPlatform?: boolean;
}

/**
 * Run `fn` inside a request-scoped DB context: a dedicated client pinned
 * via AsyncLocalStorage, with `app.current_tenant_id` (+ optional
 * `app.is_platform`) set as SESSION-level GUCs. RLS policies on the tables
 * gate on these.
 *
 * NOT a transaction. Each query the handler issues still runs as its own
 * autocommit statement, so a failing query does not poison subsequent ones
 * — which is what per-transaction `set_config(..., true)` caused before
 * the refactor. Explicit `withTransaction` calls inside the handler still
 * open BEGIN/COMMIT on this same client and see the session GUCs.
 *
 * On return — success or failure — the session GUCs are RESET so the client
 * goes back to the pool clean and cannot leak tenant context into whichever
 * request gets it next.
 */
export async function runWithTenantContext<T>(
  opts: TenantContextOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await realPool.connect();
  let touched = false;
  try {
    if (opts.tenantId) {
      await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [
        opts.tenantId,
      ]);
      touched = true;
    }
    if (opts.isPlatform) {
      await client.query(`SELECT set_config('app.is_platform', 'on', false)`);
      touched = true;
    }
    return await als.run({ client }, fn);
  } finally {
    if (touched) {
      try {
        // RESET returns the GUC to its default (unset, as if never set).
        // Using DISCARD would nuke prepared statements too — overkill.
        await client.query(`RESET app.current_tenant_id`);
        await client.query(`RESET app.is_platform`);
      } catch (resetErr) {
        log.error({ resetErr }, 'failed to reset tenant session vars');
      }
    }
    client.release();
  }
}

export type Queryable = pg.Pool | pg.PoolClient;
