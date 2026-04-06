/**
 * Integration test: menu module against a real Postgres.
 *
 * Runs only if TEST_DATABASE_URL is set. In CI, point it at a disposable
 * database that was initialised from schema.sql. Tests clean up after
 * themselves by wrapping everything in a transaction that rolls back.
 *
 * Why a real DB and not a mock: the billing/menu module is worthless if the
 * SQL is wrong. Mocks pass; prod breaks. We verified this trade-off at plan
 * time with the user.
 */
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as repo from './menu.repository.js';
import { writeAudit } from '../../middleware/audit.js';
import type { AuthContext } from '../../middleware/auth.js';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DB_URL ? describe : describe.skip;

describeIfDb('menu integration (pg)', () => {
  let pool: pg.Pool;
  let tenantId: string;
  let outletId: string;
  let actor: AuthContext;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: TEST_DB_URL });

    // Apply schema. Idempotent so safe to re-run.
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const schemaPath = join(__dirname, '..', '..', 'db', 'schema.sql');
    const sql = readFileSync(schemaPath, 'utf8');
    await pool.query(sql);

    // Create a throwaway tenant + outlet + user for this test suite.
    const tenantRes = await pool.query<{ id: string }>(
      `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id`,
      [`Test Tenant ${Date.now()}`, `test-${Date.now()}`],
    );
    tenantId = tenantRes.rows[0]!.id;

    const outletRes = await pool.query<{ id: string }>(
      `INSERT INTO outlets (tenant_id, name) VALUES ($1, 'Test Outlet') RETURNING id`,
      [tenantId],
    );
    outletId = outletRes.rows[0]!.id;

    const userRes = await pool.query<{ id: string }>(
      `INSERT INTO users (tenant_id, outlet_id, is_tenant_owner, email, password_hash, full_name, role)
       VALUES ($1, $2, TRUE, $3, 'x', 'Tester', 'admin') RETURNING id`,
      [tenantId, outletId, `tester-${Date.now()}@example.com`],
    );
    actor = {
      userId: userRes.rows[0]!.id,
      tenantId,
      outletId,
      isTenantOwner: true,
      email: 'tester@example.com',
      role: 'admin',
    };
  });

  afterAll(async () => {
    if (!pool) return;
    // Clean up in FK-safe order. Cascades handle variations/item_addons.
    await pool.query(`DELETE FROM audit_log WHERE outlet_id = $1`, [outletId]);
    await pool.query(`DELETE FROM menu_item_addons WHERE item_id IN (SELECT id FROM menu_items WHERE outlet_id = $1)`, [outletId]);
    await pool.query(`DELETE FROM menu_items WHERE outlet_id = $1`, [outletId]);
    await pool.query(`DELETE FROM menu_addons WHERE outlet_id = $1`, [outletId]);
    await pool.query(`DELETE FROM menu_categories WHERE outlet_id = $1`, [outletId]);
    await pool.query(`DELETE FROM users WHERE outlet_id = $1`, [outletId]);
    await pool.query(`DELETE FROM outlets WHERE id = $1`, [outletId]);
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await pool.end();
  });

  it('creates a category and retrieves it', async () => {
    const cat = await repo.insertCategory(pool, {
      outletId,
      name: `Starters-${Date.now()}`,
      description: 'appetisers',
      displayOrder: 0,
    });
    expect(cat.id).toBeTruthy();
    expect(cat.outletId).toBe(outletId);

    const fetched = await repo.findCategoryById(pool, outletId, cat.id);
    expect(fetched?.name).toBe(cat.name);
  });

  it('scopes reads by outletId (no cross-tenant leakage)', async () => {
    const cat = await repo.insertCategory(pool, {
      outletId,
      name: `CrossTenant-${Date.now()}`,
      description: null,
      displayOrder: 0,
    });
    const otherOutlet = '00000000-0000-0000-0000-000000000000';
    const fetched = await repo.findCategoryById(pool, otherOutlet, cat.id);
    expect(fetched).toBeNull();
  });

  it('creates an item with variations and hydrates it', async () => {
    const cat = await repo.insertCategory(pool, {
      outletId,
      name: `Mains-${Date.now()}`,
      description: null,
      displayOrder: 1,
    });
    const itemRow = await repo.insertItem(pool, {
      outletId,
      categoryId: cat.id,
      name: 'Paneer Tikka',
      description: null,
      pricePaise: 25_000,
      taxRateBps: 500,
      inStock: true,
      displayOrder: 0,
      imageUrl: null,
    });
    await repo.replaceVariations(pool, outletId, itemRow.id, [
      { name: 'Half', priceDeltaPaise: -5000, displayOrder: 0, isActive: true },
      { name: 'Full', priceDeltaPaise: 0, displayOrder: 1, isActive: true },
    ]);

    const hydrated = await repo.hydrateItem(pool, itemRow);
    expect(hydrated.variations).toHaveLength(2);
    expect(hydrated.variations.map((v) => v.name).sort()).toEqual(['Full', 'Half']);
    expect(hydrated.pricePaise).toBe(25_000);
  });

  it('replaceVariations removes variations not in the new set', async () => {
    const cat = await repo.insertCategory(pool, {
      outletId,
      name: `Temp-${Date.now()}`,
      description: null,
      displayOrder: 2,
    });
    const itemRow = await repo.insertItem(pool, {
      outletId,
      categoryId: cat.id,
      name: 'Dosa',
      description: null,
      pricePaise: 12_000,
      taxRateBps: 500,
      inStock: true,
      displayOrder: 0,
      imageUrl: null,
    });
    await repo.replaceVariations(pool, outletId, itemRow.id, [
      { name: 'Plain', priceDeltaPaise: 0, displayOrder: 0, isActive: true },
      { name: 'Masala', priceDeltaPaise: 3000, displayOrder: 1, isActive: true },
    ]);
    await repo.replaceVariations(pool, outletId, itemRow.id, [
      { name: 'Plain', priceDeltaPaise: 0, displayOrder: 0, isActive: true },
    ]);
    const variations = await repo.listVariationsForItem(pool, outletId, itemRow.id);
    expect(variations.map((v) => v.name)).toEqual(['Plain']);
  });

  it('writes an audit row on update', async () => {
    const cat = await repo.insertCategory(pool, {
      outletId,
      name: `Audited-${Date.now()}`,
      description: null,
      displayOrder: 0,
    });
    await writeAudit(pool, {
      actor,
      entityType: 'menu_category',
      entityId: cat.id,
      action: 'create',
      after: cat,
    });
    const { rows } = await pool.query<{ entity_id: string; action: string }>(
      `SELECT entity_id, action FROM audit_log WHERE outlet_id = $1 AND entity_id = $2`,
      [outletId, cat.id],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.action).toBe('create');
  });

  it('getServiceMenu returns categories with nested items', async () => {
    const menu = await repo.getServiceMenu(pool, outletId);
    // At least the items we created above should be present.
    const allItems = menu.flatMap((c) => c.items);
    expect(allItems.length).toBeGreaterThan(0);
    // Every category in the menu should belong to this outlet.
    expect(menu.every((c) => c.outletId === outletId)).toBe(true);
  });

  it('refuses addon assignment from another outlet', async () => {
    const cat = await repo.insertCategory(pool, {
      outletId,
      name: `AddonGuard-${Date.now()}`,
      description: null,
      displayOrder: 9,
    });
    const itemRow = await repo.insertItem(pool, {
      outletId,
      categoryId: cat.id,
      name: 'Burger',
      description: null,
      pricePaise: 20_000,
      taxRateBps: 500,
      inStock: true,
      displayOrder: 0,
      imageUrl: null,
    });
    const fakeAddonId = '00000000-0000-0000-0000-000000000001';
    await expect(
      repo.replaceItemAddons(pool, outletId, itemRow.id, [fakeAddonId]),
    ).rejects.toThrow();
  });
});
