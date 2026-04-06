/**
 * Nuclear reset: drops all tables, re-applies schema, seeds a test tenant
 * with users in every role. For development/testing only.
 *
 * Usage: npx tsx src/db/reset-and-seed.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';
import { hashPassword } from '../modules/auth/auth.service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TENANT_NAME = 'Taj Kitchen';
const TENANT_SLUG = 'taj-kitchen';
const OUTLET_NAME = 'Taj Kitchen — Main';
const SHARED_PASSWORD = 'TestPass123!';

const TEST_USERS = [
  { email: 'admin@tajkitchen.com', fullName: 'Ekam (Owner)', role: 'admin', isOwner: true },
  { email: 'manager@tajkitchen.com', fullName: 'Priya (Manager)', role: 'manager', isOwner: false },
  { email: 'staff@tajkitchen.com', fullName: 'Raj (Staff)', role: 'staff', isOwner: false },
  { email: 'kitchen@tajkitchen.com', fullName: 'Anil (Kitchen)', role: 'kitchen', isOwner: false },
] as const;

async function main() {
  // Schema should already be applied via `npm run db:migrate`.
  // This script only seeds data into an empty database.
  console.log('Assuming schema is already applied (run `npm run db:migrate` first).');

  console.log('\n🏗️  CREATING TENANT & OUTLET...');
  const tenantRes = await pool.query<{ id: string }>(
    `INSERT INTO tenants (name, slug, status) VALUES ($1, $2, 'active') RETURNING id`,
    [TENANT_NAME, TENANT_SLUG],
  );
  const tenantId = tenantRes.rows[0]!.id;

  const outletRes = await pool.query<{ id: string }>(
    `INSERT INTO outlets (tenant_id, name) VALUES ($1, $2) RETURNING id`,
    [tenantId, OUTLET_NAME],
  );
  const outletId = outletRes.rows[0]!.id;
  console.log(`✅ Tenant: ${TENANT_NAME} (${tenantId})`);
  console.log(`   Outlet: ${OUTLET_NAME} (${outletId})`);

  console.log('\n👤 CREATING USERS...');
  const passwordHash = await hashPassword(SHARED_PASSWORD);

  for (const u of TEST_USERS) {
    const userRes = await pool.query<{ id: string }>(
      `INSERT INTO users (tenant_id, outlet_id, is_tenant_owner, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [tenantId, outletId, u.isOwner, u.email, passwordHash, u.fullName, u.role],
    );
    // Grant outlet access for non-owners
    if (!u.isOwner) {
      await pool.query(
        `INSERT INTO user_outlet_access (user_id, outlet_id, role) VALUES ($1, $2, $3)`,
        [userRes.rows[0]!.id, outletId, u.role],
      );
    }
    console.log(`   ✅ ${u.role.padEnd(8)} → ${u.email} (${u.fullName})`);
  }

  console.log('\n🍽️  SEEDING DEMO MENU & TABLES...');

  // Categories (with parent hierarchy)
  const topCategories = [
    { name: 'Starters', order: 1 },
    { name: 'Main Course', order: 2 },
    { name: 'Breads', order: 3 },
    { name: 'Beverages', order: 4 },
    { name: 'Desserts', order: 5 },
  ];
  const catIds = new Map<string, string>();
  for (const c of topCategories) {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO menu_categories (outlet_id, name, display_order) VALUES ($1, $2, $3) RETURNING id`,
      [outletId, c.name, c.order],
    );
    catIds.set(c.name, r.rows[0]!.id);
  }
  // Sub-categories (parent_id demo)
  const subCategories = [
    { name: 'Veg Starters', parent: 'Starters', order: 1 },
    { name: 'Non-Veg Starters', parent: 'Starters', order: 2 },
    { name: 'Hot Beverages', parent: 'Beverages', order: 1 },
    { name: 'Cold Beverages', parent: 'Beverages', order: 2 },
  ];
  for (const sc of subCategories) {
    const parentId = catIds.get(sc.parent);
    if (!parentId) continue;
    const r = await pool.query<{ id: string }>(
      `INSERT INTO menu_categories (outlet_id, name, parent_id, display_order) VALUES ($1, $2, $3, $4) RETURNING id`,
      [outletId, sc.name, parentId, sc.order],
    );
    catIds.set(sc.name, r.rows[0]!.id);
  }
  console.log(`   ✅ ${topCategories.length} top categories + ${subCategories.length} sub-categories`);

  // Items (price in paise, tax in bps: 500 = 5%)
  // Includes all Phase 1 fields: food_type, short_code, hsn_code, packing_charge_paise, goods_or_services
  const items = [
    { cat: 'Starters', name: 'Paneer Tikka',     price: 24000, tax: 500,  foodType: 'veg',     shortCode: 'PT',  hsn: '9963', packing: 2000 },
    { cat: 'Starters', name: 'Veg Manchurian',   price: 19000, tax: 500,  foodType: 'veg',     shortCode: 'VM',  hsn: '9963', packing: 2000 },
    { cat: 'Starters', name: 'Chicken 65',       price: 28000, tax: 500,  foodType: 'non-veg', shortCode: 'C65', hsn: '9963', packing: 2000 },
    { cat: 'Starters', name: 'Egg Bhurji',       price: 15000, tax: 500,  foodType: 'egg',     shortCode: 'EB',  hsn: '9963', packing: 1500 },
    { cat: 'Main Course', name: 'Butter Chicken', price: 36000, tax: 500,  foodType: 'non-veg', shortCode: 'BC',  hsn: '9963', packing: 3000 },
    { cat: 'Main Course', name: 'Dal Makhani',   price: 22000, tax: 500,  foodType: 'veg',     shortCode: 'DM',  hsn: '9963', packing: 2500 },
    { cat: 'Main Course', name: 'Palak Paneer',  price: 24000, tax: 500,  foodType: 'veg',     shortCode: 'PP',  hsn: '9963', packing: 2500 },
    { cat: 'Main Course', name: 'Biryani',       price: 28000, tax: 500,  foodType: 'non-veg', shortCode: 'BIR', hsn: '9963', packing: 3000 },
    { cat: 'Main Course', name: 'Mutton Rogan Josh', price: 42000, tax: 500, foodType: 'non-veg', shortCode: 'MRJ', hsn: '9963', packing: 3000 },
    { cat: 'Breads', name: 'Butter Naan',        price: 6000,  tax: 500,  foodType: 'veg',     shortCode: 'BN',  hsn: '9963', packing: 500 },
    { cat: 'Breads', name: 'Garlic Naan',        price: 7000,  tax: 500,  foodType: 'veg',     shortCode: 'GN',  hsn: '9963', packing: 500 },
    { cat: 'Breads', name: 'Tandoori Roti',      price: 4000,  tax: 500,  foodType: 'veg',     shortCode: 'TR',  hsn: '9963', packing: 500 },
    { cat: 'Beverages', name: 'Masala Chai',      price: 4000,  tax: 500,  foodType: 'veg',     shortCode: 'MC',  hsn: '9963', packing: 1000 },
    { cat: 'Beverages', name: 'Fresh Lime Soda',  price: 8000,  tax: 1800, foodType: 'veg',     shortCode: 'FLS', hsn: '2202', packing: 1000 },
    { cat: 'Beverages', name: 'Mango Lassi',      price: 10000, tax: 1800, foodType: 'veg',     shortCode: 'ML',  hsn: '2202', packing: 1000 },
    { cat: 'Desserts', name: 'Gulab Jamun',       price: 8000,  tax: 500,  foodType: 'veg',     shortCode: 'GJ',  hsn: '9963', packing: 1500 },
    { cat: 'Desserts', name: 'Kulfi',             price: 10000, tax: 500,  foodType: 'veg',     shortCode: 'KF',  hsn: '9963', packing: 1500 },
  ] as const;
  for (const it of items) {
    const catId = catIds.get(it.cat);
    if (!catId) continue;
    await pool.query(
      `INSERT INTO menu_items (
         outlet_id, category_id, name, price_paise, tax_rate_bps,
         food_type, short_code, hsn_code, packing_charge_paise, goods_or_services
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'services')`,
      [outletId, catId, it.name, it.price, it.tax, it.foodType, it.shortCode, it.hsn, it.packing],
    );
  }
  console.log(`   ✅ ${items.length} menu items (with food_type, short_code, hsn_code, packing charges)`);

  // Variations on Butter Chicken (Half/Full) and Biryani (Veg/Chicken)
  const bcRow = await pool.query<{ id: string }>(
    `SELECT id FROM menu_items WHERE outlet_id = $1 AND name = 'Butter Chicken'`, [outletId],
  );
  if (bcRow.rows[0]) {
    await pool.query(
      `INSERT INTO menu_item_variations (item_id, name, price_delta_paise, display_order) VALUES
       ($1, 'Half', -12000, 1), ($1, 'Full', 0, 2)`,
      [bcRow.rows[0].id],
    );
  }
  const birRow = await pool.query<{ id: string }>(
    `SELECT id FROM menu_items WHERE outlet_id = $1 AND name = 'Biryani'`, [outletId],
  );
  if (birRow.rows[0]) {
    await pool.query(
      `INSERT INTO menu_item_variations (item_id, name, price_delta_paise, display_order) VALUES
       ($1, 'Veg', -4000, 1), ($1, 'Chicken', 0, 2)`,
      [birRow.rows[0].id],
    );
  }
  console.log('   ✅ Variations: Butter Chicken (Half/Full), Biryani (Veg/Chicken)');

  // Addons
  const addonNames = [
    { name: 'Extra Cheese', price: 3000 },
    { name: 'Extra Gravy', price: 2000 },
    { name: 'Raita', price: 4000 },
  ];
  const addonIds: string[] = [];
  for (const a of addonNames) {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO menu_addons (outlet_id, name, price_paise) VALUES ($1, $2, $3) RETURNING id`,
      [outletId, a.name, a.price],
    );
    addonIds.push(r.rows[0]!.id);
  }
  // Wire Extra Cheese to Paneer Tikka, Extra Gravy to Butter Chicken, Raita to Biryani
  const ptRow = await pool.query<{ id: string }>(
    `SELECT id FROM menu_items WHERE outlet_id = $1 AND name = 'Paneer Tikka'`, [outletId],
  );
  if (ptRow.rows[0] && addonIds[0]) {
    await pool.query(`INSERT INTO menu_item_addons (item_id, addon_id) VALUES ($1, $2)`, [ptRow.rows[0].id, addonIds[0]]);
  }
  if (bcRow.rows[0] && addonIds[1]) {
    await pool.query(`INSERT INTO menu_item_addons (item_id, addon_id) VALUES ($1, $2)`, [bcRow.rows[0].id, addonIds[1]]);
  }
  if (birRow.rows[0] && addonIds[2]) {
    await pool.query(`INSERT INTO menu_item_addons (item_id, addon_id) VALUES ($1, $2)`, [birRow.rows[0].id, addonIds[2]]);
  }
  console.log('   ✅ 3 ungrouped addons wired to menu items');

  // Addon Groups (Phase 3 demo)
  // Group 1: "Spice Level" — single selection, required (min=1)
  const spiceGroupRes = await pool.query<{ id: string }>(
    `INSERT INTO menu_addon_groups (outlet_id, name, selection_type, min_selections, max_selections, display_order)
     VALUES ($1, 'Spice Level', 'single', 1, 1, 1) RETURNING id`,
    [outletId],
  );
  const spiceGroupId = spiceGroupRes.rows[0]!.id;

  const spiceLevels = [
    { name: 'Mild', price: 0 },
    { name: 'Medium', price: 0 },
    { name: 'Hot', price: 0 },
    { name: 'Extra Hot', price: 500 },
  ];
  const spiceAddonIds: string[] = [];
  for (const s of spiceLevels) {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO menu_addons (outlet_id, name, price_paise, addon_group_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [outletId, s.name, s.price, spiceGroupId],
    );
    spiceAddonIds.push(r.rows[0]!.id);
  }

  // Group 2: "Extra Toppings" — multi selection, pick 0-3
  const toppingsGroupRes = await pool.query<{ id: string }>(
    `INSERT INTO menu_addon_groups (outlet_id, name, selection_type, min_selections, max_selections, display_order)
     VALUES ($1, 'Extra Toppings', 'multi', 0, 3, 2) RETURNING id`,
    [outletId],
  );
  const toppingsGroupId = toppingsGroupRes.rows[0]!.id;

  const toppings = [
    { name: 'Onion Rings', price: 2000 },
    { name: 'Jalapeño', price: 1500 },
    { name: 'Mushroom', price: 2500 },
    { name: 'Corn', price: 1500 },
    { name: 'Paneer Cubes', price: 3000 },
  ];
  for (const t of toppings) {
    await pool.query(
      `INSERT INTO menu_addons (outlet_id, name, price_paise, addon_group_id) VALUES ($1, $2, $3, $4)`,
      [outletId, t.name, t.price, toppingsGroupId],
    );
  }

  // Wire addon groups to items:
  // Spice Level → Butter Chicken, Biryani, Chicken 65, Mutton Rogan Josh
  // Extra Toppings → Paneer Tikka, Biryani
  const spiceItems = ['Butter Chicken', 'Biryani', 'Chicken 65', 'Mutton Rogan Josh'];
  for (const itemName of spiceItems) {
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM menu_items WHERE outlet_id = $1 AND name = $2`, [outletId, itemName],
    );
    if (r.rows[0]) {
      await pool.query(
        `INSERT INTO menu_item_addon_groups (item_id, addon_group_id) VALUES ($1, $2)`,
        [r.rows[0].id, spiceGroupId],
      );
    }
  }
  const toppingItems = ['Paneer Tikka', 'Biryani'];
  for (const itemName of toppingItems) {
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM menu_items WHERE outlet_id = $1 AND name = $2`, [outletId, itemName],
    );
    if (r.rows[0]) {
      await pool.query(
        `INSERT INTO menu_item_addon_groups (item_id, addon_group_id) VALUES ($1, $2)`,
        [r.rows[0].id, toppingsGroupId],
      );
    }
  }
  console.log('   ✅ 2 addon groups (Spice Level: single/required, Extra Toppings: multi/0-3)');
  console.log('     Spice Level → Butter Chicken, Biryani, Chicken 65, Mutton Rogan Josh');
  console.log('     Extra Toppings → Paneer Tikka, Biryani');

  // Tables
  const tables = [
    { code: 'T1', label: 'Window 1', section: 'Main', seats: 2, order: 1 },
    { code: 'T2', label: 'Window 2', section: 'Main', seats: 2, order: 2 },
    { code: 'T3', label: 'Center 1', section: 'Main', seats: 4, order: 3 },
    { code: 'T4', label: 'Center 2', section: 'Main', seats: 4, order: 4 },
    { code: 'T5', label: 'Family', section: 'Main', seats: 6, order: 5 },
    { code: 'T6', label: 'Party', section: 'Main', seats: 8, order: 6 },
    { code: 'G1', label: 'Garden 1', section: 'Garden', seats: 4, order: 7 },
    { code: 'G2', label: 'Garden 2', section: 'Garden', seats: 4, order: 8 },
  ];
  for (const t of tables) {
    await pool.query(
      `INSERT INTO dining_tables (outlet_id, code, label, section, seats, display_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [outletId, t.code, t.label, t.section, t.seats, t.order],
    );
  }
  console.log(`   ✅ ${tables.length} tables`);

  // Update outlet settings for receipt testing
  await pool.query(
    `UPDATE outlets SET
       address_line1 = '42 MG Road',
       address_line2 = 'Near City Mall',
       city = 'Mumbai',
       state = 'Maharashtra',
       pincode = '400001',
       phone = '+91 98765 43210',
       email = 'hello@tajkitchen.com',
       gstin = '27AABCT1234F1ZP',
       fssai_no = '10012345000123'
     WHERE id = $1`,
    [outletId],
  );
  console.log('   ✅ Outlet settings (address, GSTIN, FSSAI) configured');

  console.log('\n==========================================================');
  console.log('🎉 RESET & SEED COMPLETE');
  console.log('==========================================================');
  console.log(`Tenant:   ${TENANT_NAME}`);
  console.log(`Slug:     ${TENANT_SLUG}`);
  console.log(`Login:    /t/${TENANT_SLUG}/login`);
  console.log(`Password: ${SHARED_PASSWORD} (same for all users)`);
  console.log('');
  console.log('Test accounts:');
  for (const u of TEST_USERS) {
    console.log(`  ${u.role.padEnd(8)} → ${u.email}`);
  }
  console.log('');
  console.log('Menu: 5+4 categories (with hierarchy), 17 items, 4 variations');
  console.log('Addons: 3 ungrouped + 2 groups (Spice Level, Extra Toppings)');
  console.log('New fields: food_type, short_code, hsn_code, packing charges');
  console.log('Tables: 8 (T1-T6 Main, G1-G2 Garden)');
  console.log('==========================================================\n');

  await pool.end();
}

main().catch(async (err) => {
  console.error('Reset failed:', err);
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(1);
});
