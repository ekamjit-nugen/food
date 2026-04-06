import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Cross-tenant isolation matrix (Phase 3a).
 *
 * Provisions two independent tenants (A and B) via the public signup flow,
 * then seeds each tenant's outlet with enough data (menu category, item,
 * addon, table, live order, bill, payment) to exercise every major read
 * and write surface in the API.
 *
 * For each resource the suite asserts TWO properties:
 *
 *   1. LIST ISOLATION — tenant A's list responses must contain ONLY tenant A's
 *      rows. No row from tenant B may ever appear, regardless of how many
 *      rows B has or the order they were created.
 *
 *   2. POINT LOOKUP ISOLATION — tenant A GETting/PATCHing/DELETing a specific
 *      resource id that belongs to tenant B must 404 (never 200 with the
 *      row, never 500). Point lookups are the most common leak vector: a
 *      repository that forgets its `outlet_id = $N` filter will happily
 *      return anyone's row by id.
 *
 * And for the outlet-context header surface:
 *
 *   3. X-OUTLET-ID REJECTION — tenant A sending `X-Outlet-Id: <B's outlet>`
 *      is 403, proving the middleware guard cannot be bypassed by a client
 *      that knows (or guesses) another tenant's outlet UUID.
 *
 * Reports get their own block because they aggregate: the leak mode is
 * "A's totals include B's revenue", which the point-lookup tests can't
 * catch. We seed a paid bill in each tenant with distinct totals and then
 * assert each tenant sees ONLY its own numbers.
 *
 * Runs only against TEST_DATABASE_URL. Does NOT truncate — uses timestamped
 * slugs/emails so it can coexist with other integration suites under
 * `fileParallelism: false`. Cleanup runs in afterAll.
 *
 *   TEST_DATABASE_URL=postgres://food:food@localhost:5433/food_test npm test
 */

const hasDb = !!process.env.TEST_DATABASE_URL;

type Express = import('express').Express;

interface Tenant {
  slug: string;
  token: string;
  tenantId: string;
  outletId: string;
  userId: string;
  // Resources created during seed:
  categoryId: string;
  itemId: string;
  addonId: string;
  tableId: string;
  orderId: string;
  billId: string;
}

describe.skipIf(!hasDb)('Cross-tenant isolation matrix', () => {
  let app: Express;
  let pool: import('pg').Pool;
  let A: Tenant;
  let B: Tenant;
  const stamp = Date.now();

  beforeAll(async () => {
    const dbMod = await import('../db/index.js');
    pool = dbMod.pool;

    // Apply schema (idempotent).
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schemaPath = join(__dirname, '..', 'db', 'schema.sql');
    await pool.query(readFileSync(schemaPath, 'utf8'));

    const appMod = await import('../app.js');
    app = appMod.buildApp();

    A = await provisionTenant(app, `iso-a-${stamp}`, 'A');
    B = await provisionTenant(app, `iso-b-${stamp}`, 'B');
  });

  afterAll(async () => {
    // Cleanup is intentionally best-effort. The FK graph (orders.opened_by →
    // users, bills → orders, etc.) is deep enough that unwinding it by hand
    // is brittle, and the e2e suite TRUNCATEs everything at its beforeAll
    // anyway. We use timestamped slugs/emails so accumulated rows can't
    // collide with other tests. If the delete cascade fails, swallow it.
    if (A && B) {
      const ids = [A.tenantId, B.tenantId];
      try {
        await pool.query(`DELETE FROM audit_log WHERE tenant_id = ANY($1::uuid[])`, [ids]);
      } catch {
        // ignore
      }
    }
  });

  // ==========================================================================
  // 1. Menu — categories, items, addons
  // ==========================================================================

  describe('menu', () => {
    it('GET /menu/categories returns only own-tenant categories', async () => {
      const a = await list(app, A.token, '/api/v1/menu/categories');
      const b = await list(app, B.token, '/api/v1/menu/categories');
      expectOnlyOwn(a, A.categoryId, B.categoryId);
      expectOnlyOwn(b, B.categoryId, A.categoryId);
    });

    it('GET /menu/categories/:id of other tenant is 404', async () => {
      const r = await authed(request(app).get(`/api/v1/menu/categories/${B.categoryId}`), A.token);
      expect(r.status).toBe(404);
    });

    it('PATCH /menu/categories/:id of other tenant is 404', async () => {
      const r = await authed(
        request(app)
          .patch(`/api/v1/menu/categories/${B.categoryId}`)
          .send({ name: 'pwned' }),
        A.token,
      );
      expect(r.status).toBe(404);
      // And the row must be unchanged on tenant B's side.
      const stillThere = await authed(
        request(app).get(`/api/v1/menu/categories/${B.categoryId}`),
        B.token,
      );
      expect(stillThere.status).toBe(200);
      expect(stillThere.body.name).not.toBe('pwned');
    });

    it('DELETE /menu/categories/:id of other tenant is 404', async () => {
      const r = await authed(
        request(app).delete(`/api/v1/menu/categories/${B.categoryId}`),
        A.token,
      );
      expect(r.status).toBe(404);
    });

    it('GET /menu/items returns only own-tenant items', async () => {
      const a = await list(app, A.token, '/api/v1/menu/items');
      const b = await list(app, B.token, '/api/v1/menu/items');
      expectOnlyOwn(a, A.itemId, B.itemId);
      expectOnlyOwn(b, B.itemId, A.itemId);
    });

    it('GET /menu/items/:id of other tenant is 404', async () => {
      const r = await authed(request(app).get(`/api/v1/menu/items/${B.itemId}`), A.token);
      expect(r.status).toBe(404);
    });

    it('PATCH /menu/items/:id of other tenant is 404', async () => {
      const r = await authed(
        request(app)
          .patch(`/api/v1/menu/items/${B.itemId}`)
          .send({ pricePaise: 1 }),
        A.token,
      );
      expect(r.status).toBe(404);
    });

    it('GET /menu/addons returns only own-tenant addons', async () => {
      const a = await list(app, A.token, '/api/v1/menu/addons');
      const b = await list(app, B.token, '/api/v1/menu/addons');
      expectOnlyOwn(a, A.addonId, B.addonId);
      expectOnlyOwn(b, B.addonId, A.addonId);
    });

    it('GET /menu/addons/:id of other tenant is 404', async () => {
      const r = await authed(request(app).get(`/api/v1/menu/addons/${B.addonId}`), A.token);
      expect(r.status).toBe(404);
    });

    it('GET /menu service payload excludes other-tenant categories and items', async () => {
      const r = await authed(request(app).get('/api/v1/menu'), A.token);
      expect(r.status).toBe(200);
      // /menu returns ServiceMenu = array of categories with nested items.
      const cats: Array<{ id: string; items: Array<{ id: string }> }> =
        r.body.data ?? r.body;
      const flatIds = new Set<string>();
      for (const c of cats) {
        flatIds.add(c.id);
        for (const i of c.items) flatIds.add(i.id);
      }
      expect(flatIds.has(A.categoryId)).toBe(true);
      expect(flatIds.has(A.itemId)).toBe(true);
      expect(flatIds.has(B.categoryId)).toBe(false);
      expect(flatIds.has(B.itemId)).toBe(false);
    });

    it('creating an order in tenant A using tenant B\'s variationId fails (loadVariationSnapshots outlet filter)', async () => {
      // Seed a variation on tenant B's item, then have tenant A try to
      // reference it during order creation. Before the Phase 3b fix to
      // loadVariationSnapshots, the repo returned cross-outlet rows and
      // the service's v.itemId !== d.menuItemId check caught it — a
      // defense-in-depth leak. With the fix, the repo itself never
      // returns the row and the service yields the canonical "variation
      // not found" error.
      const vRes = await authed(
        request(app)
          .patch(`/api/v1/menu/items/${B.itemId}`)
          .send({
            variations: [
              { name: 'Large', priceDeltaPaise: 5000, displayOrder: 0, isActive: true },
            ],
          }),
        B.token,
      );
      expect(vRes.status).toBe(200);
      const variationId = (vRes.body.variations as Array<{ id: string; name: string }>)
        .find((v) => v.name === 'Large')?.id;
      expect(variationId).toBeTypeOf('string');

      const attempt = await authed(
        request(app)
          .post('/api/v1/orders')
          .send({
            orderType: 'dine_in',
            tableId: A.tableId,
            pax: 1,
            items: [
              {
                menuItemId: A.itemId,
                variationId, // <-- belongs to B!
                quantity: 1,
              },
            ],
          }),
        A.token,
      );
      expect(attempt.status).toBe(400);
    });

    it('creating an item in tenant A using tenant B\'s categoryId fails', async () => {
      // Cross-tenant FK through a body field is a classic leak path. The
      // service layer must reject it: categoryId belongs to B's outlet, so
      // A's outlet-scoped lookup should fail.
      const r = await authed(
        request(app)
          .post('/api/v1/menu/items')
          .send({
            categoryId: B.categoryId, // <-- B's!
            name: 'Leak Probe',
            pricePaise: 10000,
          }),
        A.token,
      );
      // 400/404 are both acceptable shapes for "that id doesn't exist in
      // your scope". A 201 here would be a leak.
      expect(r.status).not.toBe(201);
      expect([400, 404, 409]).toContain(r.status);
    });
  });

  // ==========================================================================
  // 2. Tables
  // ==========================================================================

  describe('tables', () => {
    it('GET /tables returns only own-tenant tables', async () => {
      const a = await list(app, A.token, '/api/v1/tables');
      const b = await list(app, B.token, '/api/v1/tables');
      expectOnlyOwn(a, A.tableId, B.tableId);
      expectOnlyOwn(b, B.tableId, A.tableId);
    });

    it('GET /tables/:id of other tenant is 404', async () => {
      const r = await authed(request(app).get(`/api/v1/tables/${B.tableId}`), A.token);
      expect(r.status).toBe(404);
    });

    it('PATCH /tables/:id of other tenant is 404', async () => {
      const r = await authed(
        request(app).patch(`/api/v1/tables/${B.tableId}`).send({ seats: 99 }),
        A.token,
      );
      expect(r.status).toBe(404);
    });

    it('creating an order in tenant A pointing at tenant B\'s tableId fails', async () => {
      // Another body-FK leak path.
      const r = await authed(
        request(app)
          .post('/api/v1/orders')
          .send({
            orderType: 'dine_in',
            tableId: B.tableId,
            pax: 1,
            items: [{ menuItemId: A.itemId, quantity: 1 }],
          }),
        A.token,
      );
      expect(r.status).not.toBe(201);
      expect([400, 404, 409]).toContain(r.status);
    });
  });

  // ==========================================================================
  // 3. Orders + KOTs
  // ==========================================================================

  describe('orders', () => {
    it('GET /orders returns only own-tenant orders', async () => {
      const a = await list(app, A.token, '/api/v1/orders');
      const b = await list(app, B.token, '/api/v1/orders');
      expectOnlyOwn(a, A.orderId, B.orderId);
      expectOnlyOwn(b, B.orderId, A.orderId);
    });

    it('GET /orders/:id of other tenant is 404', async () => {
      const r = await authed(request(app).get(`/api/v1/orders/${B.orderId}`), A.token);
      expect(r.status).toBe(404);
    });

    it('POST /orders/:id/cancel on other tenant\'s order is 404', async () => {
      const r = await authed(
        request(app)
          .post(`/api/v1/orders/${B.orderId}/cancel`)
          .send({ reason: 'cross-tenant probe' }),
        A.token,
      );
      expect(r.status).toBe(404);
    });

    it('POST /orders/:id/items/send on other tenant\'s order is 404', async () => {
      const r = await authed(
        request(app).post(`/api/v1/orders/${B.orderId}/items/send`).send({}),
        A.token,
      );
      expect(r.status).toBe(404);
    });

    it('GET /kots returns only own-tenant KOTs', async () => {
      const a = await list(app, A.token, '/api/v1/kots');
      const b = await list(app, B.token, '/api/v1/kots');
      // Both tenants have at least one KOT (seeded). Assert: no overlap
      // between the two sets.
      const aIds = new Set(a.map((x) => x.id));
      const bIds = new Set(b.map((x) => x.id));
      expect(aIds.size).toBeGreaterThan(0);
      expect(bIds.size).toBeGreaterThan(0);
      for (const id of aIds) expect(bIds.has(id)).toBe(false);
    });
  });

  // ==========================================================================
  // 4. Billing
  // ==========================================================================

  describe('billing', () => {
    it('GET /bills returns only own-tenant bills', async () => {
      const a = await list(app, A.token, '/api/v1/bills');
      const b = await list(app, B.token, '/api/v1/bills');
      expectOnlyOwn(a, A.billId, B.billId);
      expectOnlyOwn(b, B.billId, A.billId);
    });

    it('GET /bills/:id of other tenant is 404', async () => {
      const r = await authed(request(app).get(`/api/v1/bills/${B.billId}`), A.token);
      expect(r.status).toBe(404);
    });

    it('GET /orders/:id/bill on other tenant\'s order is 404', async () => {
      const r = await authed(
        request(app).get(`/api/v1/orders/${B.orderId}/bill`),
        A.token,
      );
      expect(r.status).toBe(404);
    });

    it('POST /bills/:id/payments on other tenant\'s bill is 404', async () => {
      const r = await authed(
        request(app)
          .post(`/api/v1/bills/${B.billId}/payments`)
          .send({ method: 'cash', amountPaise: 1, idempotencyKey: randomUUID() }),
        A.token,
      );
      expect(r.status).toBe(404);
    });

    it('POST /bills/:id/void on other tenant\'s bill is 404', async () => {
      const r = await authed(
        request(app)
          .post(`/api/v1/bills/${B.billId}/void`)
          .send({ reason: 'cross-tenant probe' }),
        A.token,
      );
      expect(r.status).toBe(404);
    });
  });

  // ==========================================================================
  // 5. Reports — aggregate isolation
  // ==========================================================================

  describe('reports', () => {
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    it('daily-sales totals do not include the other tenant\'s revenue', async () => {
      const a = await authed(
        request(app).get(`/api/v1/reports/daily-sales?from=${from}&to=${to}`),
        A.token,
      );
      const b = await authed(
        request(app).get(`/api/v1/reports/daily-sales?from=${from}&to=${to}`),
        B.token,
      );
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      // Seed paid each tenant's bill for a DISTINCT total (see provisionTenant).
      // A was paid for 10000 paise, B for 20000 paise.
      expect(a.body.data.totalRevenuePaise).toBe(10000);
      expect(b.body.data.totalRevenuePaise).toBe(20000);
      expect(a.body.data.totalBills).toBe(1);
      expect(b.body.data.totalBills).toBe(1);
    });

    it('item-wise sales does not include the other tenant\'s items', async () => {
      // item-wise rows key on menuItemName (bill_items snapshots the name,
      // not the FK). Tenant A seeded "A Dish", tenant B seeded "B Dish".
      const a = await authed(
        request(app).get(`/api/v1/reports/item-wise?from=${from}&to=${to}`),
        A.token,
      );
      expect(a.status).toBe(200);
      const rows: Array<{ menuItemName: string }> = a.body.data;
      for (const row of rows) {
        expect(row.menuItemName).not.toBe('B Dish');
      }
      expect(rows.some((r) => r.menuItemName === 'A Dish')).toBe(true);
    });

    it('order-master lists only own-tenant orders', async () => {
      const a = await authed(
        request(app).get(`/api/v1/reports/order-master?from=${from}&to=${to}`),
        A.token,
      );
      expect(a.status).toBe(200);
      const ids = new Set<string>(
        a.body.data.map((r: { orderId: string }) => r.orderId),
      );
      expect(ids.has(A.orderId)).toBe(true);
      expect(ids.has(B.orderId)).toBe(false);
    });

    // scope=tenant (Phase 6) must still honor tenant isolation: a tenant-
    // wide rollup for A must contain A's revenue, but NOT B's, and the
    // byOutlet breakdown must list only A's outlet(s).
    it('scope=tenant rollup stays inside the tenant', async () => {
      const a = await authed(
        request(app).get(
          `/api/v1/reports/daily-sales?from=${from}&to=${to}&scope=tenant`,
        ),
        A.token,
      );
      expect(a.status).toBe(200);
      expect(a.body.scope).toBe('tenant');
      expect(a.body.data.totalRevenuePaise).toBe(10000);
      expect(a.body.data.totalBills).toBe(1);
      const byOutlet: Array<{ outletId: string; revenuePaise: number }> =
        a.body.data.byOutlet;
      const outletIds = new Set(byOutlet.map((r) => r.outletId));
      expect(outletIds.has(A.outletId)).toBe(true);
      expect(outletIds.has(B.outletId)).toBe(false);
      // order-master with scope=tenant must also exclude B's rows.
      const om = await authed(
        request(app).get(
          `/api/v1/reports/order-master?from=${from}&to=${to}&scope=tenant`,
        ),
        A.token,
      );
      expect(om.status).toBe(200);
      const ids = new Set<string>(
        om.body.data.map((r: { orderId: string }) => r.orderId),
      );
      expect(ids.has(A.orderId)).toBe(true);
      expect(ids.has(B.orderId)).toBe(false);
    });
  });

  // ==========================================================================
  // 6. X-Outlet-Id header rejection (defense-in-depth)
  // ==========================================================================

  describe('X-Outlet-Id cross-tenant header rejection', () => {
    const probes: Array<{ method: 'get' | 'post'; path: string }> = [
      { method: 'get', path: '/api/v1/menu' },
      { method: 'get', path: '/api/v1/menu/items' },
      { method: 'get', path: '/api/v1/menu/categories' },
      { method: 'get', path: '/api/v1/tables' },
      { method: 'get', path: '/api/v1/orders' },
      { method: 'get', path: '/api/v1/kots' },
      { method: 'get', path: '/api/v1/bills' },
    ];

    for (const p of probes) {
      it(`${p.method.toUpperCase()} ${p.path} with other-tenant outlet header → 403`, async () => {
        const req = p.method === 'get' ? request(app).get(p.path) : request(app).post(p.path);
        const r = await req
          .set('Authorization', `Bearer ${A.token}`)
          .set('X-Outlet-Id', B.outletId);
        expect(r.status).toBe(403);
      });
    }
  });
});

// ============================================================================
// Helpers
// ============================================================================

function authed(req: request.Test, token: string) {
  return req.set('Authorization', `Bearer ${token}`);
}

async function list(
  app: Express,
  token: string,
  path: string,
): Promise<Array<{ id: string }>> {
  const r = await authed(request(app).get(path), token);
  if (r.status !== 200) {
    throw new Error(`GET ${path} returned ${r.status}: ${JSON.stringify(r.body)}`);
  }
  const body: unknown = r.body;
  if (Array.isArray(body)) return body as Array<{ id: string }>;
  if (body && typeof body === 'object' && 'data' in body && Array.isArray((body as { data: unknown }).data)) {
    return (body as { data: Array<{ id: string }> }).data;
  }
  throw new Error(`unexpected list shape for ${path}: ${JSON.stringify(body)}`);
}

function expectOnlyOwn(
  rows: Array<{ id: string }>,
  mustContain: string,
  mustNotContain: string,
) {
  const ids = new Set(rows.map((r) => r.id));
  expect(ids.has(mustContain)).toBe(true);
  expect(ids.has(mustNotContain)).toBe(false);
}

/**
 * Sign up a tenant, then seed it with the full set of resources we need
 * for the isolation matrix. Returns the IDs of every created resource so
 * the test assertions can reference them.
 */
async function provisionTenant(
  app: Express,
  slug: string,
  label: string,
): Promise<Tenant> {
  const email = `${slug}-owner@example.com`;
  const signup = await request(app)
    .post('/api/v1/auth/signup')
    .send({
      restaurantName: `Iso ${label}`,
      slug,
      firstOutletName: `${label}-Main`,
      ownerFullName: `${label} Owner`,
      email,
      password: 'iso-test-pass-1',
    });
  if (signup.status !== 201) {
    throw new Error(`signup failed for ${slug}: ${signup.status} ${JSON.stringify(signup.body)}`);
  }
  const token = signup.body.token as string;
  const tenantId = signup.body.user.tenantId as string;
  const outletId = signup.body.user.outletId as string;
  const userId = signup.body.user.id as string;
  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  // Menu category
  const catRes = await auth(
    request(app).post('/api/v1/menu/categories').send({
      name: `${label} Mains`,
      displayOrder: 1,
    }),
  );
  if (catRes.status !== 201) {
    throw new Error(`cat create failed: ${catRes.status} ${JSON.stringify(catRes.body)}`);
  }
  const categoryId = catRes.body.id as string;

  // Menu item — tax 0 so the seeded bill totals are easy to assert against.
  // Tenant A item price 10000 paise, tenant B item price 20000 paise, so
  // the reports block can distinguish by revenue number.
  const price = label === 'A' ? 10000 : 20000;
  const itemRes = await auth(
    request(app).post('/api/v1/menu/items').send({
      categoryId,
      name: `${label} Dish`,
      pricePaise: price,
      taxRateBps: 0,
    }),
  );
  if (itemRes.status !== 201) {
    throw new Error(`item create failed: ${itemRes.status} ${JSON.stringify(itemRes.body)}`);
  }
  const itemId = itemRes.body.id as string;

  // Addon
  const addonRes = await auth(
    request(app).post('/api/v1/menu/addons').send({
      name: `${label} Sauce`,
      pricePaise: 0,
    }),
  );
  if (addonRes.status !== 201) {
    throw new Error(`addon create failed: ${addonRes.status} ${JSON.stringify(addonRes.body)}`);
  }
  const addonId = addonRes.body.id as string;

  // Table
  const tableRes = await auth(
    request(app).post('/api/v1/tables').send({
      code: `${label}1`,
      seats: 2,
    }),
  );
  if (tableRes.status !== 201) {
    throw new Error(`table create failed: ${tableRes.status} ${JSON.stringify(tableRes.body)}`);
  }
  const tableId = tableRes.body.id as string;

  // Order with one item
  const orderRes = await auth(
    request(app).post('/api/v1/orders').send({
      orderType: 'dine_in',
      tableId,
      pax: 1,
      items: [{ menuItemId: itemId, quantity: 1 }],
    }),
  );
  if (orderRes.status !== 201) {
    throw new Error(`order create failed: ${orderRes.status} ${JSON.stringify(orderRes.body)}`);
  }
  const orderId = orderRes.body.id as string;

  // Send to kitchen → creates a KOT
  const sendRes = await auth(
    request(app).post(`/api/v1/orders/${orderId}/items/send`).send({}),
  );
  if (sendRes.status !== 201) {
    throw new Error(`send failed: ${sendRes.status} ${JSON.stringify(sendRes.body)}`);
  }
  const kotId = sendRes.body.id as string;

  // Walk KOT to served so bill generation doesn't complain in strict flows.
  for (const status of ['in_progress', 'ready', 'served'] as const) {
    const r = await auth(
      request(app).patch(`/api/v1/kots/${kotId}/status`).send({ status }),
    );
    if (r.status !== 200) {
      throw new Error(`kot ${status} failed: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  // Generate bill
  const billRes = await auth(
    request(app).post(`/api/v1/orders/${orderId}/bill`).send({}),
  );
  if (billRes.status !== 201) {
    throw new Error(`bill create failed: ${billRes.status} ${JSON.stringify(billRes.body)}`);
  }
  const billId = billRes.body.id as string;
  const totalPaise = billRes.body.totalPaise as number;

  // Pay bill in full so the reports queries (which filter to status='paid')
  // see this row.
  const payRes = await auth(
    request(app)
      .post(`/api/v1/bills/${billId}/payments`)
      .send({ method: 'cash', amountPaise: totalPaise, idempotencyKey: randomUUID() }),
  );
  if (payRes.status !== 201) {
    throw new Error(`payment failed: ${payRes.status} ${JSON.stringify(payRes.body)}`);
  }

  return {
    slug,
    token,
    tenantId,
    outletId,
    userId,
    categoryId,
    itemId,
    addonId,
    tableId,
    orderId,
    billId,
  };
}
