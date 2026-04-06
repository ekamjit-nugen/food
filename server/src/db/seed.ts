import { randomBytes } from 'node:crypto';
import { pool, withTransaction } from './index.js';
import { hashPassword } from '../modules/auth/auth.service.js';
import { childLogger } from '../utils/logger.js';

/**
 * Bootstrap the first outlet and its admin user.
 *
 * Usage:
 *   npm run db:seed
 *   SEED_DEMO=1 npm run db:seed    # also loads demo menu + tables
 *
 * Env overrides (all optional):
 *   SEED_OUTLET_NAME       - default "My Restaurant"
 *   SEED_ADMIN_EMAIL       - default "admin@example.com"
 *   SEED_ADMIN_PASSWORD    - default: a random 16-char password, printed on success
 *   SEED_ADMIN_FULL_NAME   - default "Owner"
 *   SEED_DEMO              - if truthy, also seed demo categories, items, and tables
 *
 * This script is idempotent-ish: it will NOT overwrite an existing outlet
 * with the same name, and it will refuse to create a duplicate admin email.
 * Re-run with different env vars if you need a second admin.
 *
 * Demo data uses ON CONFLICT DO NOTHING so re-running with SEED_DEMO=1 is safe.
 *
 * SECURITY: print the generated password ONCE to stdout. Do not log it,
 * do not write it to a file. The operator copies it into their password
 * manager. If they miss it, they run the password reset flow (which
 * does not exist yet in v1 — so write it down carefully).
 */
const log = childLogger('seed');

function generatePassword(): string {
  // 16 URL-safe chars. Guaranteed to contain letters and digits because
  // base64url output is alphanumeric + -_.
  return randomBytes(12).toString('base64url');
}

/**
 * Demo payload: a small but realistic menu + a handful of tables, enough to
 * click through an order end-to-end in dev. Deliberately tiny — the point is
 * exercising the flows, not pretending to be a real restaurant's menu.
 *
 * Every insert uses ON CONFLICT DO NOTHING on the natural unique key, so
 * running SEED_DEMO=1 multiple times is safe and converges on the same state.
 */
async function seedDemoData(outletId: string): Promise<void> {
  await withTransaction(async (tx) => {
    // Categories
    const categories = [
      { name: 'Starters', display_order: 1 },
      { name: 'Main Course', display_order: 2 },
      { name: 'Beverages', display_order: 3 },
    ];
    for (const c of categories) {
      await tx.query(
        `INSERT INTO menu_categories (outlet_id, name, display_order)
         VALUES ($1, $2, $3)
         ON CONFLICT (outlet_id, name) DO NOTHING`,
        [outletId, c.name, c.display_order],
      );
    }

    const catRows = await tx.query<{ id: string; name: string }>(
      `SELECT id, name FROM menu_categories WHERE outlet_id = $1`,
      [outletId],
    );
    const catByName = new Map(catRows.rows.map((r) => [r.name, r.id]));

    // Items. Price in paise, tax in bps (500 = 5%, 1800 = 18%).
    const items = [
      { cat: 'Starters',    name: 'Paneer Tikka',    price: 24000, tax: 500 },
      { cat: 'Starters',    name: 'Veg Manchurian',  price: 19000, tax: 500 },
      { cat: 'Main Course', name: 'Butter Chicken',  price: 36000, tax: 500 },
      { cat: 'Main Course', name: 'Dal Makhani',     price: 22000, tax: 500 },
      { cat: 'Main Course', name: 'Garlic Naan',     price:  6000, tax: 500 },
      { cat: 'Beverages',   name: 'Masala Chai',     price:  4000, tax: 500 },
      { cat: 'Beverages',   name: 'Fresh Lime Soda', price:  8000, tax: 1800 },
    ];
    for (const it of items) {
      const categoryId = catByName.get(it.cat);
      if (!categoryId) continue;
      await tx.query(
        `INSERT INTO menu_items
            (outlet_id, category_id, name, price_paise, tax_rate_bps)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (outlet_id, category_id, name) DO NOTHING`,
        [outletId, categoryId, it.name, it.price, it.tax],
      );
    }

    // One variation on Butter Chicken (Half/Full), one addon (Extra Cheese)
    // wired to Paneer Tikka, to exercise the non-trivial ordering paths.
    const bc = await tx.query<{ id: string }>(
      `SELECT mi.id FROM menu_items mi
       JOIN menu_categories mc ON mc.id = mi.category_id
       WHERE mi.outlet_id = $1 AND mi.name = 'Butter Chicken' AND mc.name = 'Main Course'`,
      [outletId],
    );
    const bcId = bc.rows[0]?.id;
    if (bcId) {
      await tx.query(
        `INSERT INTO menu_item_variations (item_id, name, price_delta_paise, display_order)
         VALUES ($1, 'Half', -12000, 1), ($1, 'Full', 0, 2)
         ON CONFLICT (item_id, name) DO NOTHING`,
        [bcId],
      );
    }

    await tx.query(
      `INSERT INTO menu_addons (outlet_id, name, price_paise)
       VALUES ($1, 'Extra Cheese', 3000)
       ON CONFLICT (outlet_id, name) DO NOTHING`,
      [outletId],
    );
    const addon = await tx.query<{ id: string }>(
      `SELECT id FROM menu_addons WHERE outlet_id = $1 AND name = 'Extra Cheese'`,
      [outletId],
    );
    const pt = await tx.query<{ id: string }>(
      `SELECT id FROM menu_items WHERE outlet_id = $1 AND name = 'Paneer Tikka'`,
      [outletId],
    );
    if (addon.rows[0] && pt.rows[0]) {
      await tx.query(
        `INSERT INTO menu_item_addons (item_id, addon_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [pt.rows[0].id, addon.rows[0].id],
      );
    }

    // Tables: 4 in Main hall, 2 in Garden.
    const tables = [
      { code: 'T1', label: 'Main 1', section: 'Main',   seats: 4, order: 1 },
      { code: 'T2', label: 'Main 2', section: 'Main',   seats: 4, order: 2 },
      { code: 'T3', label: 'Main 3', section: 'Main',   seats: 2, order: 3 },
      { code: 'T4', label: 'Main 4', section: 'Main',   seats: 6, order: 4 },
      { code: 'G1', label: 'Garden 1', section: 'Garden', seats: 2, order: 5 },
      { code: 'G2', label: 'Garden 2', section: 'Garden', seats: 4, order: 6 },
    ];
    for (const t of tables) {
      await tx.query(
        `INSERT INTO dining_tables (outlet_id, code, label, section, seats, display_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (outlet_id, code) DO NOTHING`,
        [outletId, t.code, t.label, t.section, t.seats, t.order],
      );
    }
  });

  log.info({ outletId }, 'demo data seeded');
}

async function main() {
  const outletName = process.env.SEED_OUTLET_NAME ?? 'My Restaurant';
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase().trim();
  const adminFullName = process.env.SEED_ADMIN_FULL_NAME ?? 'Owner';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? generatePassword();
  const generated = !process.env.SEED_ADMIN_PASSWORD;

  const passwordHash = await hashPassword(adminPassword);

  const { outletId, userId } = await withTransaction(async (tx) => {
    // Find-or-create the default tenant. Seed always attaches to the
    // tenant named "Default Tenant" (slug 'default'), which is also what
    // the schema.sql backfill creates. Idempotent.
    const tenantSlug = process.env.SEED_TENANT_SLUG ?? 'default';
    const tenantName = process.env.SEED_TENANT_NAME ?? 'Default Tenant';
    const existingTenant = await tx.query<{ id: string }>(
      `SELECT id FROM tenants WHERE slug = $1 LIMIT 1`,
      [tenantSlug],
    );
    let tenantId: string;
    if (existingTenant.rows[0]) {
      tenantId = existingTenant.rows[0].id;
    } else {
      const ins = await tx.query<{ id: string }>(
        `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id`,
        [tenantName, tenantSlug],
      );
      tenantId = ins.rows[0]!.id;
      log.info({ tenantId, tenantSlug }, 'tenant created');
    }

    // Find-or-create the outlet by name within this tenant. Idempotent.
    const existing = await tx.query<{ id: string }>(
      `SELECT id FROM outlets WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
      [tenantId, outletName],
    );
    let outletId: string;
    if (existing.rows[0]) {
      outletId = existing.rows[0].id;
      log.info({ outletId, outletName }, 'outlet already exists, reusing');
    } else {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO outlets (tenant_id, name) VALUES ($1, $2) RETURNING id`,
        [tenantId, outletName],
      );
      outletId = inserted.rows[0]!.id;
      log.info({ outletId, outletName }, 'outlet created');
    }

    // Refuse to overwrite an existing admin with the same email in this outlet.
    const dup = await tx.query<{ id: string }>(
      `SELECT id FROM users WHERE outlet_id = $1 AND email = $2`,
      [outletId, adminEmail],
    );
    if (dup.rows[0]) {
      throw new Error(
        `user ${adminEmail} already exists in outlet ${outletName}; ` +
          `refusing to overwrite. Pick a different SEED_ADMIN_EMAIL or delete the existing user.`,
      );
    }

    const userRes = await tx.query<{ id: string }>(
      `INSERT INTO users (tenant_id, outlet_id, is_tenant_owner, email, password_hash, full_name, role)
       VALUES ($1, $2, TRUE, $3, $4, $5, 'admin')
       RETURNING id`,
      [tenantId, outletId, adminEmail, passwordHash, adminFullName],
    );
    return { outletId, userId: userRes.rows[0]!.id };
  });

  const seedDemo = /^(1|true|yes)$/i.test(process.env.SEED_DEMO ?? '');
  if (seedDemo) {
    await seedDemoData(outletId);
  }

  // Print credentials to stdout, deliberately bypassing the logger so no
  // sensitive data ends up in structured logs or log shippers.
  // eslint-disable-next-line no-console
  console.log('\n==========================================================');
  // eslint-disable-next-line no-console
  console.log('SEED COMPLETE');
  // eslint-disable-next-line no-console
  console.log('==========================================================');
  // eslint-disable-next-line no-console
  console.log(`Outlet:    ${outletName}  (${outletId})`);
  // eslint-disable-next-line no-console
  console.log(`Admin:     ${adminEmail}  (${userId})`);
  if (generated) {
    // eslint-disable-next-line no-console
    console.log(`Password:  ${adminPassword}`);
    // eslint-disable-next-line no-console
    console.log('\n!!! SAVE THIS PASSWORD NOW. It will not be shown again.');
    // eslint-disable-next-line no-console
    console.log('!!! There is no self-service password reset flow in v1.');
  } else {
    // eslint-disable-next-line no-console
    console.log('Password:  (using SEED_ADMIN_PASSWORD from env)');
  }
  // eslint-disable-next-line no-console
  if (/^(1|true|yes)$/i.test(process.env.SEED_DEMO ?? '')) {
    // eslint-disable-next-line no-console
    console.log('Demo data: 3 categories, 7 items, 1 variation, 1 addon, 6 tables');
    // eslint-disable-next-line no-console
    console.log('==========================================================\n');
  } else {
    // eslint-disable-next-line no-console
    console.log('==========================================================\n');
  }

  await pool.end();
}

main().catch(async (err) => {
  log.error({ err }, 'seed failed');
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
