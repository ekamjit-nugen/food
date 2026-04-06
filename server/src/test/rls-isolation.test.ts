import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';

/**
 * Phase 3c — Postgres Row Level Security.
 *
 * The cross-tenant-isolation suite proves the application-layer WHERE clauses
 * keep tenants apart. This suite proves the storage layer would hold even if
 * those WHERE clauses vanished: it runs raw SQL with NO filter and asserts
 * RLS blocks the rows anyway.
 *
 * Strategy:
 *   1. Seed two tenants with one order row each (directly via SQL; set
 *      `app.is_platform='on'` so inserts bypass the tenant predicate).
 *   2. Open a fresh connection, set `app.current_tenant_id` to tenant A,
 *      run `SELECT id, tenant_id FROM orders` WITHOUT any WHERE clause.
 *      Expect to see only A's row.
 *   3. Same connection, switch to tenant B, expect to see only B's row.
 *   4. Attempt to INSERT an orders row with an explicit tenant_id belonging
 *      to the OTHER tenant. RLS WITH CHECK must raise.
 *   5. Flip `app.is_platform='on'` and confirm all rows are visible again.
 *
 * IMPORTANT: RLS is silently bypassed when the current role has the
 * `BYPASSRLS` attribute (every superuser does). The Docker-provisioned
 * `food` role is a superuser for convenience, so this suite uses
 * `SET LOCAL ROLE food_rls_probe` to drop into a plain role for the
 * predicate assertions. Production deployments MUST connect the app pool
 * as a non-superuser role without BYPASSRLS, otherwise the RLS policies
 * are cosmetic. See DEPLOY.md.
 *
 * This test requires TEST_DATABASE_URL — skipped otherwise.
 */

const hasDb = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!hasDb)('Phase 3c — Postgres RLS enforcement', () => {
  let pool: pg.Pool;
  let tenantAId: string;
  let tenantBId: string;
  let outletAId: string;
  let outletBId: string;
  let userAId: string;
  let userBId: string;
  let orderAId: string;
  let orderBId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    const dbMod = await import('../db/index.js');
    pool = dbMod.pool;

    // Apply schema (idempotent) so the RLS policies are present. The schema
    // itself runs outside a tenant context so its DDL is unconstrained.
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schemaPath = join(__dirname, '..', 'db', 'schema.sql');
    await pool.query(readFileSync(schemaPath, 'utf8'));

    // Ensure a non-BYPASSRLS probe role exists for the enforcement assertions.
    // Idempotent — re-runs across test sessions are fine.
    await pool.query(`DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_rls_probe') THEN
          CREATE ROLE food_rls_probe NOLOGIN;
        END IF;
      END $$;`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO food_rls_probe`);
    await pool.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO food_rls_probe`,
    );
    await pool.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO food_rls_probe`,
    );

    // Seed two tenants directly via SQL. We run in a single transaction with
    // `app.is_platform='on'` so the RLS policies allow cross-tenant inserts.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.is_platform', 'on', true)`);

      const ta = await client.query<{ id: string }>(
        `INSERT INTO tenants (name, slug, status)
         VALUES ('RLS A', $1, 'active')
         RETURNING id`,
        [`rls-a-${stamp}`],
      );
      tenantAId = ta.rows[0].id;
      const tb = await client.query<{ id: string }>(
        `INSERT INTO tenants (name, slug, status)
         VALUES ('RLS B', $1, 'active')
         RETURNING id`,
        [`rls-b-${stamp}`],
      );
      tenantBId = tb.rows[0].id;

      const oa = await client.query<{ id: string }>(
        `INSERT INTO outlets (name, tenant_id)
         VALUES ('RLS A Main', $1)
         RETURNING id`,
        [tenantAId],
      );
      outletAId = oa.rows[0].id;
      const ob = await client.query<{ id: string }>(
        `INSERT INTO outlets (name, tenant_id)
         VALUES ('RLS B Main', $1)
         RETURNING id`,
        [tenantBId],
      );
      outletBId = ob.rows[0].id;

      // users.outlet_id is NOT NULL; tenant_id filled by the BEFORE INSERT trigger.
      const ua = await client.query<{ id: string }>(
        `INSERT INTO users (outlet_id, email, password_hash, full_name, role)
         VALUES ($1, $2, 'x', 'RLS A Owner', 'admin')
         RETURNING id`,
        [outletAId, `rls-a-${stamp}@example.com`],
      );
      userAId = ua.rows[0].id;
      const ub = await client.query<{ id: string }>(
        `INSERT INTO users (outlet_id, email, password_hash, full_name, role)
         VALUES ($1, $2, 'x', 'RLS B Owner', 'admin')
         RETURNING id`,
        [outletBId, `rls-b-${stamp}@example.com`],
      );
      userBId = ub.rows[0].id;

      // Dining table + order for each tenant. The trigger populates
      // tenant_id from outlet_id, so we don't pass it.
      const dtA = await client.query<{ id: string }>(
        `INSERT INTO dining_tables (outlet_id, code) VALUES ($1, 'R1') RETURNING id`,
        [outletAId],
      );
      const dtB = await client.query<{ id: string }>(
        `INSERT INTO dining_tables (outlet_id, code) VALUES ($1, 'R1') RETURNING id`,
        [outletBId],
      );

      const orA = await client.query<{ id: string }>(
        `INSERT INTO orders (outlet_id, order_type, table_id, opened_by)
         VALUES ($1, 'dine_in', $2, $3) RETURNING id`,
        [outletAId, dtA.rows[0].id, userAId],
      );
      orderAId = orA.rows[0].id;
      const orB = await client.query<{ id: string }>(
        `INSERT INTO orders (outlet_id, order_type, table_id, opened_by)
         VALUES ($1, 'dine_in', $2, $3) RETURNING id`,
        [outletBId, dtB.rows[0].id, userBId],
      );
      orderBId = orB.rows[0].id;

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (!tenantAId || !tenantBId) return;
    // Best-effort cleanup under platform bypass.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.is_platform', 'on', true)`);
      await client.query(`DELETE FROM orders WHERE tenant_id = ANY($1::uuid[])`, [
        [tenantAId, tenantBId],
      ]);
      await client.query(`DELETE FROM dining_tables WHERE tenant_id = ANY($1::uuid[])`, [
        [tenantAId, tenantBId],
      ]);
      await client.query(`DELETE FROM users WHERE tenant_id = ANY($1::uuid[])`, [
        [tenantAId, tenantBId],
      ]);
      await client.query(`DELETE FROM outlets WHERE tenant_id = ANY($1::uuid[])`, [
        [tenantAId, tenantBId],
      ]);
      await client.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [
        [tenantAId, tenantBId],
      ]);
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK').catch(() => undefined);
    } finally {
      client.release();
    }
  });

  it('trigger populates tenant_id on insert from outlet_id', async () => {
    // Sanity check: the rows we just seeded must have non-null tenant_id that
    // matches the parent outlet's tenant. If the trigger is broken, the rest
    // of the suite would pass vacuously (no matching rows).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.is_platform', 'on', true)`);
      const r = await client.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM orders WHERE id = ANY($1::uuid[])`,
        [[orderAId, orderBId]],
      );
      await client.query('COMMIT');
      const byId = Object.fromEntries(r.rows.map((row) => [row.id, row.tenant_id]));
      expect(byId[orderAId]).toBe(tenantAId);
      expect(byId[orderBId]).toBe(tenantBId);
    } finally {
      client.release();
    }
  });

  it('tenant A context sees only A\'s orders, WITHOUT any WHERE clause', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE food_rls_probe`);
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
        tenantAId,
      ]);
      // No WHERE tenant_id filter — relying purely on RLS.
      const r = await client.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM orders WHERE id = ANY($1::uuid[])`,
        [[orderAId, orderBId]],
      );
      await client.query('COMMIT');
      const ids = r.rows.map((row) => row.id);
      expect(ids).toContain(orderAId);
      expect(ids).not.toContain(orderBId);
    } finally {
      client.release();
    }
  });

  it('tenant B context sees only B\'s orders', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE food_rls_probe`);
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
        tenantBId,
      ]);
      const r = await client.query<{ id: string }>(
        `SELECT id FROM orders WHERE id = ANY($1::uuid[])`,
        [[orderAId, orderBId]],
      );
      await client.query('COMMIT');
      const ids = r.rows.map((row) => row.id);
      expect(ids).toContain(orderBId);
      expect(ids).not.toContain(orderAId);
    } finally {
      client.release();
    }
  });

  it('WITH CHECK blocks inserting into the other tenant\'s outlet', async () => {
    // Under tenant A's context, try to insert an order pointed at tenant B's
    // outlet. The trigger will fill tenant_id = B, then WITH CHECK should
    // refuse because B != current_setting('app.current_tenant_id').
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE food_rls_probe`);
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
        tenantAId,
      ]);
      await expect(
        client.query(
          `INSERT INTO orders (outlet_id, order_type, opened_by)
           VALUES ($1, 'takeaway', $2) RETURNING id`,
          [outletBId, userBId],
        ),
      ).rejects.toThrow(/row-level security|violates/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('platform bypass (app.is_platform=on) sees rows across tenants', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.is_platform', 'on', true)`);
      const r = await client.query<{ id: string }>(
        `SELECT id FROM orders WHERE id = ANY($1::uuid[])`,
        [[orderAId, orderBId]],
      );
      await client.query('COMMIT');
      const ids = new Set(r.rows.map((row) => row.id));
      expect(ids.has(orderAId)).toBe(true);
      expect(ids.has(orderBId)).toBe(true);
    } finally {
      client.release();
    }
  });

  // --------------------------------------------------------------------------
  // audit_log: append-only enforcement
  // --------------------------------------------------------------------------
  // The audit_log table has split RLS policies (SELECT + INSERT only, no
  // UPDATE/DELETE). These tests verify that a tenant session can read and
  // write audit rows but cannot modify or remove them.

  it('audit_log: tenant can SELECT and INSERT own rows', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE food_rls_probe`);
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
        tenantAId,
      ]);

      // INSERT should succeed
      await client.query(
        `INSERT INTO audit_log (outlet_id, tenant_id, actor_id, actor_email, entity_type, entity_id, action)
         VALUES ($1, $2, $3, 'test@example.com', 'test', 'rls-test', 'create')`,
        [outletAId, tenantAId, userAId],
      );

      // SELECT should return the row
      const r = await client.query<{ entity_id: string }>(
        `SELECT entity_id FROM audit_log WHERE entity_id = 'rls-test' AND tenant_id = $1`,
        [tenantAId],
      );
      expect(r.rows.length).toBeGreaterThanOrEqual(1);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('audit_log: tenant cannot UPDATE own audit rows (RLS blocks)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE food_rls_probe`);
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
        tenantAId,
      ]);

      // Seed a row first
      const ins = await client.query<{ id: string }>(
        `INSERT INTO audit_log (outlet_id, tenant_id, actor_id, actor_email, entity_type, entity_id, action)
         VALUES ($1, $2, $3, 'test@example.com', 'test', 'rls-upd-test', 'create')
         RETURNING id`,
        [outletAId, tenantAId, userAId],
      );
      const auditId = ins.rows[0].id;

      // UPDATE should either raise an error (insufficient_privilege) or
      // silently match 0 rows (no UPDATE policy → invisible to UPDATE).
      // Either outcome is acceptable; the row must remain unchanged.
      let updateBlocked = false;
      try {
        const upd = await client.query(
          `UPDATE audit_log SET action = 'tampered' WHERE id = $1`,
          [auditId],
        );
        // If no error, it should have matched 0 rows (no UPDATE policy)
        if (upd.rowCount === 0) updateBlocked = true;
      } catch {
        updateBlocked = true;
      }
      expect(updateBlocked).toBe(true);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('audit_log: tenant cannot DELETE own audit rows (RLS blocks)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE food_rls_probe`);
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [
        tenantAId,
      ]);

      // Seed a row
      const ins = await client.query<{ id: string }>(
        `INSERT INTO audit_log (outlet_id, tenant_id, actor_id, actor_email, entity_type, entity_id, action)
         VALUES ($1, $2, $3, 'test@example.com', 'test', 'rls-del-test', 'create')
         RETURNING id`,
        [outletAId, tenantAId, userAId],
      );
      const auditId = ins.rows[0].id;

      // DELETE should either raise or match 0 rows
      let deleteBlocked = false;
      try {
        const del = await client.query(
          `DELETE FROM audit_log WHERE id = $1`,
          [auditId],
        );
        if (del.rowCount === 0) deleteBlocked = true;
      } catch {
        deleteBlocked = true;
      }
      expect(deleteBlocked).toBe(true);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('unset session var = trusted context (sees everything)', async () => {
    // This is the escape hatch the migrate script / seed / tests rely on.
    // Without setting any GUC, the policy is permissive.
    const client = await pool.connect();
    try {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM orders WHERE id = ANY($1::uuid[])`,
        [[orderAId, orderBId]],
      );
      const ids = new Set(r.rows.map((row) => row.id));
      expect(ids.has(orderAId)).toBe(true);
      expect(ids.has(orderBId)).toBe(true);
    } finally {
      client.release();
    }
  });
});
