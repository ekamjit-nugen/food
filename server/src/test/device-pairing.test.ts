import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Device pairing integration test (Phase A).
 *
 * Provisions two tenants, then exercises the full mobile-app auth flow:
 *
 *   1. Admin of tenant A issues a pairing code for a staff user in A.
 *   2. Mobile client POSTs /auth/pair with the code → receives a device
 *      token bundle. The raw code is single-use and 10-min TTL.
 *   3. Mobile client POSTs /auth/device-login with the stored token →
 *      receives a short-lived tenant JWT with the right claims.
 *   4. That JWT works against /auth/me and the user sees their own tenant.
 *   5. Admin calls GET /users/:id/devices → sees the paired device.
 *   6. Admin calls DELETE /users/:id/devices/:deviceId → revoked_at set.
 *   7. /auth/device-login with the revoked token is now 401.
 *
 * Plus three cross-tenant guards that were the whole point of scoping
 * every SQL WHERE on tenant_id:
 *
 *   - Admin in A cannot issue a pairing code for a user in B (404).
 *   - Admin in A cannot list devices of a user in B (404).
 *   - Admin in A cannot revoke a device that belongs to tenant B (404),
 *     and that device must still work afterwards.
 *
 * Runs only against TEST_DATABASE_URL. Uses timestamped slugs so it can
 * coexist with the other integration suites.
 */

const hasDb = !!process.env.TEST_DATABASE_URL;

type Express = import('express').Express;

interface Tenant {
  slug: string;
  adminToken: string;
  tenantId: string;
  outletId: string;
  adminUserId: string;
  staffUserId: string;
  staffEmail: string;
}

describe.skipIf(!hasDb)('Device pairing flow', () => {
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

    A = await provisionTenant(app, `pair-a-${stamp}`, 'A');
    B = await provisionTenant(app, `pair-b-${stamp}`, 'B');
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

  // ==========================================================================
  // Happy path
  // ==========================================================================

  it('completes the full pair → login → list → revoke → blocked roundtrip', async () => {
    // 1. Admin issues a pairing code for staff.
    const pairing = await authed(
      request(app).post(`/api/v1/users/${A.staffUserId}/pairing-codes`).send({}),
      A.adminToken,
    );
    expect(pairing.status).toBe(201);
    expect(pairing.body.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(pairing.body.qrPayload).toMatch(/"kind":"food\.pair"/);
    const code = pairing.body.code as string;

    // 2. Mobile redeems the code anonymously.
    const consume = await request(app)
      .post('/api/v1/auth/pair')
      .send({ code, label: 'Pixel 7 (kitchen counter)', platform: 'android' });
    expect(consume.status).toBe(201);
    expect(consume.body.deviceToken).toMatch(
      /^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/,
    );
    expect(consume.body.device.label).toBe('Pixel 7 (kitchen counter)');
    expect(consume.body.device.platform).toBe('android');
    expect(consume.body.device.tenantId).toBe(A.tenantId);
    expect(consume.body.device.userId).toBe(A.staffUserId);
    const deviceToken = consume.body.deviceToken as string;
    const deviceId = consume.body.device.id as string;

    // 3. Single-use: second redeem must 401.
    const second = await request(app)
      .post('/api/v1/auth/pair')
      .send({ code, label: 'Other device' });
    expect(second.status).toBe(401);

    // 4. Device-login exchanges the long-lived token for a JWT.
    const login = await request(app)
      .post('/api/v1/auth/device-login')
      .send({ deviceToken });
    expect(login.status).toBe(200);
    expect(typeof login.body.token).toBe('string');
    expect(login.body.user.id).toBe(A.staffUserId);
    expect(login.body.user.tenantId).toBe(A.tenantId);
    const jwt = login.body.token as string;

    // 5. JWT works against /auth/me.
    const meRes = await authed(request(app).get('/api/v1/auth/me'), jwt);
    expect(meRes.status).toBe(200);
    expect(meRes.body.id).toBe(A.staffUserId);
    expect(meRes.body.tenantId).toBe(A.tenantId);

    // 6. Admin lists devices for the staff user.
    const listRes = await authed(
      request(app).get(`/api/v1/users/${A.staffUserId}/devices`),
      A.adminToken,
    );
    expect(listRes.status).toBe(200);
    const devices = listRes.body.data as Array<{ id: string; revokedAt: string | null }>;
    expect(devices.some((d) => d.id === deviceId && d.revokedAt === null)).toBe(true);

    // 7. Admin revokes the device.
    const revoke = await authed(
      request(app).delete(`/api/v1/users/${A.staffUserId}/devices/${deviceId}`),
      A.adminToken,
    );
    expect(revoke.status).toBe(200);
    expect(revoke.body.revokedAt).not.toBeNull();

    // 8. The stored device token is now worthless.
    const blocked = await request(app)
      .post('/api/v1/auth/device-login')
      .send({ deviceToken });
    expect(blocked.status).toBe(401);

    // 9. Revoking again is a 404 (already revoked / not found).
    const revokeAgain = await authed(
      request(app).delete(`/api/v1/users/${A.staffUserId}/devices/${deviceId}`),
      A.adminToken,
    );
    expect(revokeAgain.status).toBe(404);
  });

  // ==========================================================================
  // Input validation
  // ==========================================================================

  it('rejects garbage pairing codes with 401 (not 500)', async () => {
    const r = await request(app)
      .post('/api/v1/auth/pair')
      .send({ code: 'ZZZZZZZZ', label: 'nope' });
    expect(r.status).toBe(401);
  });

  it('rejects malformed device tokens with 400 or 401', async () => {
    const r = await request(app)
      .post('/api/v1/auth/device-login')
      .send({ deviceToken: 'not-a-token' });
    expect([400, 401]).toContain(r.status);
  });

  it('rejects device tokens with a bogus deviceId prefix with 401', async () => {
    // Well-formed shape, nonexistent device id. Repository UUID guard +
    // NOT FOUND path must collapse to Unauthorized, never 500.
    const r = await request(app)
      .post('/api/v1/auth/device-login')
      .send({
        deviceToken:
          '00000000-0000-0000-0000-000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      });
    expect(r.status).toBe(401);
  });

  // ==========================================================================
  // Cross-tenant isolation
  // ==========================================================================

  it('admin of A cannot issue a pairing code for a user in B', async () => {
    const r = await authed(
      request(app).post(`/api/v1/users/${B.staffUserId}/pairing-codes`).send({}),
      A.adminToken,
    );
    expect(r.status).toBe(404);
  });

  it('admin of A cannot list devices of a user in B', async () => {
    const r = await authed(
      request(app).get(`/api/v1/users/${B.staffUserId}/devices`),
      A.adminToken,
    );
    expect(r.status).toBe(404);
  });

  it('admin of A cannot revoke a device belonging to B, and B\'s device stays working', async () => {
    // Pair a device in B.
    const pairing = await authed(
      request(app).post(`/api/v1/users/${B.staffUserId}/pairing-codes`).send({}),
      B.adminToken,
    );
    expect(pairing.status).toBe(201);
    const consume = await request(app)
      .post('/api/v1/auth/pair')
      .send({ code: pairing.body.code, label: 'B phone' });
    expect(consume.status).toBe(201);
    const deviceToken = consume.body.deviceToken as string;
    const deviceId = consume.body.device.id as string;

    // Admin A tries to revoke using B's staff user id in the URL (the
    // only shape the admin router accepts). WHERE tenant_id = A must
    // miss the row.
    const attempt = await authed(
      request(app).delete(`/api/v1/users/${A.staffUserId}/devices/${deviceId}`),
      A.adminToken,
    );
    expect(attempt.status).toBe(404);

    // B's device must still be able to log in.
    const login = await request(app)
      .post('/api/v1/auth/device-login')
      .send({ deviceToken });
    expect(login.status).toBe(200);
    expect(login.body.user.tenantId).toBe(B.tenantId);
  });
});

// ============================================================================
// Helpers
// ============================================================================

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
      restaurantName: `Pair ${label}`,
      slug,
      firstOutletName: `${label}-Main`,
      ownerFullName: `${label} Owner`,
      email: ownerEmail,
      password: 'pair-test-pass-1',
    });
  if (signup.status !== 201) {
    throw new Error(`signup failed for ${slug}: ${signup.status} ${JSON.stringify(signup.body)}`);
  }
  const adminToken = signup.body.token as string;
  const tenantId = signup.body.user.tenantId as string;
  const outletId = signup.body.user.outletId as string;
  const adminUserId = signup.body.user.id as string;

  // Create a staff user — the one we will pair.
  const staffEmail = `${slug}-staff@example.com`;
  const staffRes = await authed(
    request(app).post('/api/v1/users').send({
      email: staffEmail,
      password: 'staff-test-pass-1',
      fullName: `${label} Staff`,
      role: 'staff',
    }),
    adminToken,
  );
  if (staffRes.status !== 201) {
    throw new Error(`staff create failed: ${staffRes.status} ${JSON.stringify(staffRes.body)}`);
  }
  const staffUserId = staffRes.body.id as string;

  return {
    slug,
    adminToken,
    tenantId,
    outletId,
    adminUserId,
    staffUserId,
    staffEmail,
  };
}
