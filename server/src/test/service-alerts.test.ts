import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Service alerts integration test (Phase B).
 *
 * Exercises the full floor ↔ kitchen call-button flow:
 *
 *   1. Staff raises an alert (kind=call_manager, free-text note).
 *   2. Active list contains it; ack flips acknowledged_at.
 *   3. Re-acking the same id 404s (idempotency).
 *   4. Active list is now empty; full history still shows the acked row.
 *   5. Alerts with a tableId from another outlet are rejected (400).
 *   6. Cross-tenant isolation: tenant A cannot see tenant B's alerts.
 *
 * Runs only against TEST_DATABASE_URL.
 */

const hasDb = !!process.env.TEST_DATABASE_URL;

type Express = import('express').Express;

interface Tenant {
  slug: string;
  token: string;
  tenantId: string;
  outletId: string;
  tableId: string;
}

describe.skipIf(!hasDb)('Service alerts flow', () => {
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

    A = await provisionTenant(app, `alert-a-${stamp}`, 'A');
    B = await provisionTenant(app, `alert-b-${stamp}`, 'B');
  });

  afterAll(async () => {
    if (A && B) {
      try {
        await pool.query(
          `DELETE FROM audit_log WHERE tenant_id = ANY($1::uuid[])`,
          [[A.tenantId, B.tenantId]],
        );
      } catch {
        // best-effort
      }
    }
  });

  it('raises, lists, and acks an alert end-to-end', async () => {
    // 1. Raise.
    const create = await authed(
      request(app).post('/api/v1/alerts').send({
        kind: 'call_manager',
        tableId: A.tableId,
        note: 'Customer wants a comp',
      }),
      A.token,
    );
    expect(create.status).toBe(201);
    expect(create.body.kind).toBe('call_manager');
    expect(create.body.tenantId).toBe(A.tenantId);
    expect(create.body.outletId).toBe(A.outletId);
    expect(create.body.tableId).toBe(A.tableId);
    expect(create.body.note).toBe('Customer wants a comp');
    expect(create.body.acknowledgedAt).toBeNull();
    const alertId = create.body.id as string;

    // 2. Active list.
    const active = await authed(request(app).get('/api/v1/alerts'), A.token);
    expect(active.status).toBe(200);
    const activeIds = (active.body.data as Array<{ id: string }>).map((a) => a.id);
    expect(activeIds).toContain(alertId);

    // 3. Ack.
    const ack = await authed(
      request(app).post(`/api/v1/alerts/${alertId}/ack`).send({}),
      A.token,
    );
    expect(ack.status).toBe(200);
    expect(ack.body.acknowledgedAt).not.toBeNull();
    expect(ack.body.acknowledgedBy).toBeTypeOf('string');

    // 4. Re-ack → 404.
    const reAck = await authed(
      request(app).post(`/api/v1/alerts/${alertId}/ack`).send({}),
      A.token,
    );
    expect(reAck.status).toBe(404);

    // 5. Active list no longer contains it.
    const active2 = await authed(request(app).get('/api/v1/alerts'), A.token);
    const active2Ids = (active2.body.data as Array<{ id: string }>).map((a) => a.id);
    expect(active2Ids).not.toContain(alertId);

    // 6. Full history still shows it.
    const full = await authed(request(app).get('/api/v1/alerts?active=false'), A.token);
    const fullIds = (full.body.data as Array<{ id: string }>).map((a) => a.id);
    expect(fullIds).toContain(alertId);
  });

  it('accepts alerts without tableId or note', async () => {
    const r = await authed(
      request(app).post('/api/v1/alerts').send({ kind: 'call_waiter' }),
      A.token,
    );
    expect(r.status).toBe(201);
    expect(r.body.tableId).toBeNull();
    expect(r.body.note).toBeNull();
  });

  it('rejects an alert with a tableId from a different outlet (400)', async () => {
    const r = await authed(
      request(app).post('/api/v1/alerts').send({
        kind: 'call_waiter',
        tableId: B.tableId, // <-- B's table!
      }),
      A.token,
    );
    expect(r.status).toBe(400);
  });

  it('rejects invalid kinds with 400', async () => {
    const r = await authed(
      request(app).post('/api/v1/alerts').send({ kind: 'call_police' }),
      A.token,
    );
    expect(r.status).toBe(400);
  });

  it('tenant A never sees tenant B\'s alerts', async () => {
    // Raise one alert per tenant with the same kind.
    const aRes = await authed(
      request(app).post('/api/v1/alerts').send({ kind: 'call_kitchen' }),
      A.token,
    );
    const bRes = await authed(
      request(app).post('/api/v1/alerts').send({ kind: 'call_kitchen' }),
      B.token,
    );
    expect(aRes.status).toBe(201);
    expect(bRes.status).toBe(201);
    const aAlertId = aRes.body.id as string;
    const bAlertId = bRes.body.id as string;

    // Each tenant's list must contain only its own.
    const aList = await authed(request(app).get('/api/v1/alerts'), A.token);
    const bList = await authed(request(app).get('/api/v1/alerts'), B.token);
    const aIds = new Set((aList.body.data as Array<{ id: string }>).map((x) => x.id));
    const bIds = new Set((bList.body.data as Array<{ id: string }>).map((x) => x.id));
    expect(aIds.has(aAlertId)).toBe(true);
    expect(aIds.has(bAlertId)).toBe(false);
    expect(bIds.has(bAlertId)).toBe(true);
    expect(bIds.has(aAlertId)).toBe(false);

    // Tenant A cannot ack tenant B's alert (404, not 200).
    const crossAck = await authed(
      request(app).post(`/api/v1/alerts/${bAlertId}/ack`).send({}),
      A.token,
    );
    expect(crossAck.status).toBe(404);

    // And B's alert is still unacked.
    const stillOpen = await authed(request(app).get('/api/v1/alerts'), B.token);
    const stillIds = (stillOpen.body.data as Array<{ id: string }>).map((a) => a.id);
    expect(stillIds).toContain(bAlertId);
  });

  it('requires auth', async () => {
    const r = await request(app).post('/api/v1/alerts').send({ kind: 'call_waiter' });
    expect(r.status).toBe(401);
  });
});

function authed(req: request.Test, token: string): request.Test {
  return req.set('Authorization', `Bearer ${token}`);
}

async function provisionTenant(
  app: Express,
  slug: string,
  label: string,
): Promise<Tenant> {
  const ownerEmail = `${slug}-owner@example.com`;
  const signup = await request(app)
    .post('/api/v1/auth/signup')
    .send({
      restaurantName: `Alert ${label}`,
      slug,
      firstOutletName: `${label}-Main`,
      ownerFullName: `${label} Owner`,
      email: ownerEmail,
      password: 'alert-test-pass-1',
    });
  if (signup.status !== 201) {
    throw new Error(`signup failed: ${signup.status} ${JSON.stringify(signup.body)}`);
  }
  const token = signup.body.token as string;
  const tenantId = signup.body.user.tenantId as string;
  const outletId = signup.body.user.outletId as string;

  // Create a dining table so we have an id to reference in the happy path.
  const tableRes = await authed(
    request(app).post('/api/v1/tables').send({
      code: `${label}-T1`,
      seats: 4,
    }),
    token,
  );
  if (tableRes.status !== 201) {
    throw new Error(`table create failed: ${tableRes.status} ${JSON.stringify(tableRes.body)}`);
  }

  return {
    slug,
    token,
    tenantId,
    outletId,
    tableId: tableRes.body.id as string,
  };
}
