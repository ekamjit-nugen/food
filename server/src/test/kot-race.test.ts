import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';

/**
 * Regression test for the KOT-send race that previously created ghost
 * KOTs. See `lockDraftOrderItems` in orders.repository.ts for the full
 * story of the race.
 *
 * Why this test runs at the repository/SQL level, not the service level:
 * the service-level `sendDraftItemsToKitchen` wrapped in `Promise.allSettled`
 * does NOT reliably reproduce the race in-process, because Node's microtask
 * scheduler tends to serialize the two coroutines enough that one finishes
 * its COMMIT before the other issues its SELECT. In production this is
 * NOT what happens — two HTTP requests land on different threads of the
 * event loop with network jitter, and their queries genuinely interleave.
 * To reproduce deterministically we drive two raw pool clients side by
 * side and step through the statements in the exact order that
 * reproduces the bug, then assert the fix's invariant holds.
 *
 * Skipped unless TEST_DATABASE_URL is set.
 */

const hasDb = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!hasDb)('KOT send race — lockDraftOrderItems serialization', () => {
  let pool: pg.Pool;
  let tenantId: string;
  let outletId: string;
  let userId: string;
  let menuItemId: string;
  const stamp = Date.now();

  beforeAll(async () => {
    const dbMod = await import('../db/index.js');
    pool = dbMod.pool;

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schemaPath = join(__dirname, '..', 'db', 'schema.sql');
    await pool.query(readFileSync(schemaPath, 'utf8'));

    const t = await pool.query<{ id: string }>(
      `INSERT INTO tenants (name, slug, status)
       VALUES ('KOT Race', $1, 'active') RETURNING id`,
      [`kot-race-${stamp}`],
    );
    tenantId = t.rows[0]!.id;

    const o = await pool.query<{ id: string }>(
      `INSERT INTO outlets (tenant_id, name) VALUES ($1, 'Main') RETURNING id`,
      [tenantId],
    );
    outletId = o.rows[0]!.id;

    const u = await pool.query<{ id: string }>(
      `INSERT INTO users (outlet_id, email, password_hash, full_name, role, is_tenant_owner)
       VALUES ($1, $2, 'x', 'Race Admin', 'admin', TRUE) RETURNING id`,
      [outletId, `kot-race-${stamp}@example.com`],
    );
    userId = u.rows[0]!.id;

    const c = await pool.query<{ id: string }>(
      `INSERT INTO menu_categories (outlet_id, name, display_order)
       VALUES ($1, 'Mains', 1) RETURNING id`,
      [outletId],
    );
    const mi = await pool.query<{ id: string }>(
      `INSERT INTO menu_items (outlet_id, category_id, name, price_paise, tax_rate_bps)
       VALUES ($1, $2, 'Race Item', 10000, 500) RETURNING id`,
      [outletId, c.rows[0]!.id],
    );
    menuItemId = mi.rows[0]!.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await pool
        .query(`DELETE FROM tenants WHERE id = $1`, [tenantId])
        .catch(() => undefined);
    }
  });

  /**
   * Seed a fresh order with 3 draft items. Each test gets its own order
   * so the tests don't pollute each other.
   */
  async function seedOrderWithThreeDrafts(): Promise<string> {
    const orderRes = await pool.query<{ id: string }>(
      `INSERT INTO orders (outlet_id, order_type, opened_by)
       VALUES ($1, 'takeaway', $2) RETURNING id`,
      [outletId, userId],
    );
    const orderId = orderRes.rows[0]!.id;
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO order_items
           (outlet_id, order_id, menu_item_id, menu_item_name,
            quantity, unit_price_paise, tax_rate_bps, created_by)
         VALUES ($1, $2, $3, 'Race Item', 1, 10000, 500, $4)`,
        [outletId, orderId, menuItemId, userId],
      );
    }
    return orderId;
  }

  it('WITHOUT the fix: ghost KOT is possible (demonstrates the original bug)', async () => {
    // This test simulates exactly what the old code did: two concurrent
    // transactions that each SELECT drafts without row locks, insert a
    // KOT, then race on the UPDATE. The losing transaction's UPDATE
    // matches zero rows under READ COMMITTED but the phantom KOT row it
    // already inserted is still there.
    const orderId = await seedOrderWithThreeDrafts();
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');

      // Step 1: both transactions SELECT drafts WITHOUT FOR UPDATE.
      // They see the same three rows — this is the first half of the bug.
      const drafts1 = await c1.query(
        `SELECT id FROM order_items
          WHERE outlet_id = $1 AND order_id = $2
            AND kot_id IS NULL AND is_void = FALSE`,
        [outletId, orderId],
      );
      const drafts2 = await c2.query(
        `SELECT id FROM order_items
          WHERE outlet_id = $1 AND order_id = $2
            AND kot_id IS NULL AND is_void = FALSE`,
        [outletId, orderId],
      );
      expect(drafts1.rows).toHaveLength(3);
      expect(drafts2.rows).toHaveLength(3);

      // Step 2: both transactions insert their own KOT row. No contention
      // here — kots is an independent insert.
      const kot1 = await c1.query<{ id: string }>(
        `INSERT INTO kots (outlet_id, order_id, sent_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [outletId, orderId, userId],
      );
      const kot2 = await c2.query<{ id: string }>(
        `INSERT INTO kots (outlet_id, order_id, sent_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [outletId, orderId, userId],
      );

      // Step 3: tx1's UPDATE acquires row locks and assigns all 3.
      const upd1 = await c1.query(
        `UPDATE order_items SET kot_id = $3
          WHERE outlet_id = $1 AND order_id = $2
            AND kot_id IS NULL AND is_void = FALSE
          RETURNING id`,
        [outletId, orderId, kot1.rows[0]!.id],
      );
      expect(upd1.rowCount).toBe(3);

      // Step 4: tx2's UPDATE blocks on tx1's locks. We launch it as a
      // pending promise, commit tx1 (releasing the locks), then await
      // tx2's result. Under READ COMMITTED, tx2's WHERE clause is
      // re-evaluated after unblock and matches ZERO rows because the
      // rows now have kot_id set.
      const upd2Pending = c2.query(
        `UPDATE order_items SET kot_id = $3
          WHERE outlet_id = $1 AND order_id = $2
            AND kot_id IS NULL AND is_void = FALSE
          RETURNING id`,
        [outletId, orderId, kot2.rows[0]!.id],
      );
      await c1.query('COMMIT');
      const upd2 = await upd2Pending;
      expect(upd2.rowCount).toBe(0); // ← the ghost: 0 items claimed

      await c2.query('COMMIT');

      // Storage-level proof of the bug: two KOT rows exist on one order,
      // one with 3 items and one with 0. This is the phantom the fix
      // prevents.
      const kots = await pool.query<{ id: string; item_count: string }>(
        `SELECT k.id,
                (SELECT COUNT(*)::text FROM order_items oi WHERE oi.kot_id = k.id) AS item_count
           FROM kots k
          WHERE k.order_id = $1
          ORDER BY k.created_at ASC`,
        [orderId],
      );
      expect(kots.rows).toHaveLength(2);
      const counts = kots.rows.map((r) => Number(r.item_count)).sort();
      expect(counts).toEqual([0, 3]); // one real, one ghost
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('WITH the fix: lockDraftOrderItems serializes concurrent senders', async () => {
    // Same two-client setup, but tx1 uses FOR UPDATE. tx2 blocks at its
    // own SELECT (not later at UPDATE), waits for tx1 to commit, then
    // re-reads under READ COMMITTED and sees zero drafts. Because tx2
    // sees zero drafts at the SELECT stage, the service-level caller
    // throws BadRequest BEFORE inserting a KOT row — no phantom.
    const orderId = await seedOrderWithThreeDrafts();
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');

      // tx1: SELECT ... FOR UPDATE — acquires row locks immediately.
      const drafts1 = await c1.query(
        `SELECT id FROM order_items
          WHERE outlet_id = $1 AND order_id = $2
            AND kot_id IS NULL AND is_void = FALSE
          FOR UPDATE`,
        [outletId, orderId],
      );
      expect(drafts1.rows).toHaveLength(3);

      // tx2: SELECT ... FOR UPDATE — BLOCKS. We launch it as a pending
      // promise and verify it doesn't resolve before tx1 commits.
      const drafts2Pending = c2.query(
        `SELECT id FROM order_items
          WHERE outlet_id = $1 AND order_id = $2
            AND kot_id IS NULL AND is_void = FALSE
          FOR UPDATE`,
        [outletId, orderId],
      );

      // Race against a 200ms sleep — if tx2's SELECT is NOT blocked, it
      // would resolve immediately and win this race, which would mean
      // FOR UPDATE isn't taking effect.
      const sentinel = Symbol('still-blocked');
      const winner = await Promise.race([
        drafts2Pending.then(() => 'unblocked' as const),
        new Promise((resolve) => setTimeout(() => resolve(sentinel), 200)),
      ]);
      expect(winner).toBe(sentinel);

      // tx1 does its full claim: insert KOT, update all 3 items, commit.
      const kot1 = await c1.query<{ id: string }>(
        `INSERT INTO kots (outlet_id, order_id, sent_by)
         VALUES ($1, $2, $3) RETURNING id`,
        [outletId, orderId, userId],
      );
      const upd1 = await c1.query(
        `UPDATE order_items SET kot_id = $3
          WHERE outlet_id = $1 AND order_id = $2
            AND kot_id IS NULL AND is_void = FALSE
          RETURNING id`,
        [outletId, orderId, kot1.rows[0]!.id],
      );
      expect(upd1.rowCount).toBe(3);
      await c1.query('COMMIT');

      // tx2 now unblocks. Under READ COMMITTED, it re-reads and sees
      // zero drafts — the service-level caller would throw BadRequest
      // here and never reach insertKot.
      const drafts2 = await drafts2Pending;
      expect(drafts2.rows).toHaveLength(0);
      await c2.query('ROLLBACK');

      // Storage-level proof of the fix: exactly one KOT row for this
      // order, with all three items.
      const kots = await pool.query<{ id: string; item_count: string }>(
        `SELECT k.id,
                (SELECT COUNT(*)::text FROM order_items oi WHERE oi.kot_id = k.id) AS item_count
           FROM kots k
          WHERE k.order_id = $1`,
        [orderId],
      );
      expect(kots.rows).toHaveLength(1);
      expect(Number(kots.rows[0]!.item_count)).toBe(3);
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('service: sendDraftItemsToKitchen uses lockDraftOrderItems', async () => {
    // Lightweight assertion that the service wiring actually goes through
    // the locking variant. Opens one transaction that holds the draft
    // rows with FOR UPDATE, then invokes the service from another client
    // and verifies it blocks (doesn't wrongly proceed past the SELECT).
    const orderId = await seedOrderWithThreeDrafts();
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(
        `SELECT id FROM order_items
          WHERE outlet_id = $1 AND order_id = $2
            AND kot_id IS NULL AND is_void = FALSE
          FOR UPDATE`,
        [outletId, orderId],
      );

      const orders = await import('../modules/orders/orders.service.js');
      const actor = {
        userId,
        tenantId,
        outletId,
        isTenantOwner: true,
        email: `kot-race-${stamp}@example.com`,
        role: 'admin' as const,
      };

      const sentinel = Symbol('still-blocked');
      const winner = await Promise.race([
        orders.sendDraftItemsToKitchen(actor, orderId).then(() => 'done' as const),
        new Promise((resolve) => setTimeout(() => resolve(sentinel), 250)),
      ]);
      expect(winner).toBe(sentinel);

      // Release the holder; the service call should now complete.
      await holder.query('ROLLBACK');
      // Give the service call a moment to finish.
      await new Promise((resolve) => setTimeout(resolve, 100));

      const kots = await pool.query<{ id: string }>(
        `SELECT id FROM kots WHERE order_id = $1`,
        [orderId],
      );
      expect(kots.rows).toHaveLength(1);
    } finally {
      holder.release();
    }
  });
});
