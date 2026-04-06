import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * PDF reprint integration test (Phase C).
 *
 * Exercises GET /bills/:id/pdf and GET /kots/:id/pdf end-to-end: provisions
 * a tenant, drives the full order → KOT → bill → payment flow, then asks
 * for the PDFs. We do NOT try to diff rendered pixels — pdfkit output is
 * unstable across versions. Instead we assert:
 *
 *   1. Response status 200.
 *   2. Content-Type is application/pdf.
 *   3. Body starts with the PDF magic bytes (%PDF-) and is non-trivially
 *      large (> 1 KB) so we catch the "empty buffer" regression.
 *   4. 401/404 for unauthenticated and cross-tenant requests.
 *
 * The renderer itself is exercised by (a) the fact that pdfkit throws if
 * passed invalid data (dates, fonts) and (b) eyeball-checking a saved
 * fixture during development. The integration test's job is to keep the
 * wiring honest.
 */

const hasDb = !!process.env.TEST_DATABASE_URL;

type Express = import('express').Express;

interface Tenant {
  slug: string;
  token: string;
  tenantId: string;
  outletId: string;
  billId: string;
  kotId: string;
}

describe.skipIf(!hasDb)('PDF reprint', () => {
  let app: Express;
  let pool: import('pg').Pool;
  let A: Tenant;
  let B: Tenant;
  const stamp = Date.now();

  beforeAll(async () => {
    const dbMod = await import('../db/index.js');
    pool = dbMod.pool;

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schemaPath = join(__dirname, '..', 'db', 'schema.sql');
    await pool.query(readFileSync(schemaPath, 'utf8'));

    const appMod = await import('../app.js');
    app = appMod.buildApp();

    A = await provisionTenantWithBill(app, `pdf-a-${stamp}`, 'A');
    B = await provisionTenantWithBill(app, `pdf-b-${stamp}`, 'B');
  });

  afterAll(async () => {
    if (A && B) {
      try {
        await pool.query(
          `DELETE FROM audit_log WHERE tenant_id = ANY($1::uuid[])`,
          [[A.tenantId, B.tenantId]],
        );
      } catch {
        // ignore
      }
    }
  });

  it('returns a valid PDF for a bill in the actor\'s outlet', async () => {
    const r = await authed(
      request(app).get(`/api/v1/bills/${A.billId}/pdf`).buffer(true).parse(bufferParser),
      A.token,
    );
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    const body = r.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.length).toBeGreaterThan(1024);
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('returns a valid PDF for a KOT in the actor\'s outlet', async () => {
    const r = await authed(
      request(app).get(`/api/v1/kots/${A.kotId}/pdf`).buffer(true).parse(bufferParser),
      A.token,
    );
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    const body = r.body as Buffer;
    expect(body.length).toBeGreaterThan(1024);
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('401 when no auth', async () => {
    const r = await request(app).get(`/api/v1/bills/${A.billId}/pdf`);
    expect(r.status).toBe(401);
  });

  it('404 when fetching another tenant\'s bill PDF', async () => {
    const r = await authed(
      request(app).get(`/api/v1/bills/${B.billId}/pdf`),
      A.token,
    );
    expect(r.status).toBe(404);
  });

  it('404 when fetching another tenant\'s KOT PDF', async () => {
    const r = await authed(
      request(app).get(`/api/v1/kots/${B.kotId}/pdf`),
      A.token,
    );
    expect(r.status).toBe(404);
  });

  it('400 on a malformed bill id', async () => {
    const r = await authed(
      request(app).get('/api/v1/bills/not-a-uuid/pdf'),
      A.token,
    );
    expect(r.status).toBe(400);
  });
});

function authed(req: request.Test, token: string): request.Test {
  return req.set('Authorization', `Bearer ${token}`);
}

/** Supertest parser that collects the body as a Buffer. The default text
 *  parser mangles binary PDF bytes; pass this via `.parse(bufferParser)`
 *  after `.buffer(true)`. */
function bufferParser(
  res: import('http').IncomingMessage,
  cb: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
  res.on('error', (err) => cb(err, Buffer.alloc(0)));
}

async function provisionTenantWithBill(
  app: Express,
  slug: string,
  label: string,
): Promise<Tenant> {
  const ownerEmail = `${slug}-owner@example.com`;
  const signup = await request(app)
    .post('/api/v1/auth/signup')
    .send({
      restaurantName: `Pdf ${label}`,
      slug,
      firstOutletName: `${label}-Main`,
      ownerFullName: `${label} Owner`,
      email: ownerEmail,
      password: 'pdf-test-pass-1',
    });
  if (signup.status !== 201) {
    throw new Error(`signup failed: ${signup.status} ${JSON.stringify(signup.body)}`);
  }
  const token = signup.body.token as string;
  const tenantId = signup.body.user.tenantId as string;
  const outletId = signup.body.user.outletId as string;
  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

  // Menu category + item
  const catRes = await auth(
    request(app).post('/api/v1/menu/categories').send({ name: `${label} Mains`, displayOrder: 1 }),
  );
  const categoryId = catRes.body.id as string;
  const itemRes = await auth(
    request(app).post('/api/v1/menu/items').send({
      categoryId,
      name: `${label} Dish`,
      pricePaise: 15000,
      taxRateBps: 500,
    }),
  );
  const itemId = itemRes.body.id as string;

  // Table
  const tableRes = await auth(
    request(app).post('/api/v1/tables').send({ code: `${label}T1`, seats: 2 }),
  );
  const tableId = tableRes.body.id as string;

  // Order with one item, notes on the item to exercise the KOT note branch.
  const orderRes = await auth(
    request(app).post('/api/v1/orders').send({
      orderType: 'dine_in',
      tableId,
      pax: 2,
      items: [{ menuItemId: itemId, quantity: 2, notes: 'no onion' }],
    }),
  );
  const orderId = orderRes.body.id as string;

  // Send to kitchen → creates KOT
  const sendRes = await auth(
    request(app).post(`/api/v1/orders/${orderId}/items/send`).send({}),
  );
  const kotId = sendRes.body.id as string;

  // Walk through states so bill generation is happy.
  for (const status of ['in_progress', 'ready', 'served'] as const) {
    await auth(request(app).patch(`/api/v1/kots/${kotId}/status`).send({ status }));
  }

  // Generate bill
  const billRes = await auth(
    request(app).post(`/api/v1/orders/${orderId}/bill`).send({}),
  );
  const billId = billRes.body.id as string;
  const totalPaise = billRes.body.totalPaise as number;

  // Pay it so the PDF exercises the "paid" branch.
  await auth(
    request(app)
      .post(`/api/v1/bills/${billId}/payments`)
      .send({ method: 'upi', amountPaise: totalPaise, reference: 'UPI-REF-1', idempotencyKey: randomUUID() }),
  );

  return { slug, token, tenantId, outletId, billId, kotId };
}
