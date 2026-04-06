import type { Queryable } from '../../db/index.js';
import type {
  Addon,
  AddonGroup,
  AddonRef,
  Category,
  Item,
  ServiceMenu,
  ServiceMenuCategory,
  Variation,
} from './menu.types.js';

/**
 * Repository layer: all SQL lives here. No business logic, no auth checks,
 * no audit writes — the service layer is responsible for that.
 *
 * All reads and writes are scoped by outletId. Callers MUST pass the
 * outlet id from the authenticated actor; never trust a client-supplied id.
 *
 * Row → domain mapping happens in these functions, once, so the rest of
 * the codebase deals exclusively in camelCase domain types.
 */

// ============================================================================
// Categories
// ============================================================================

interface CategoryRow {
  id: string;
  outlet_id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  display_order: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    outletId: row.outlet_id,
    name: row.name,
    description: row.description,
    parentId: row.parent_id,
    displayOrder: row.display_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertCategory(
  db: Queryable,
  params: {
    outletId: string;
    name: string;
    description: string | null;
    parentId: string | null;
    displayOrder: number;
  },
): Promise<Category> {
  const { rows } = await db.query<CategoryRow>(
    `INSERT INTO menu_categories (outlet_id, name, description, parent_id, display_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [params.outletId, params.name, params.description, params.parentId, params.displayOrder],
  );
  return mapCategory(rows[0]!);
}

export async function findCategoryById(
  db: Queryable,
  outletId: string,
  id: string,
): Promise<Category | null> {
  const { rows } = await db.query<CategoryRow>(
    `SELECT * FROM menu_categories WHERE outlet_id = $1 AND id = $2`,
    [outletId, id],
  );
  return rows[0] ? mapCategory(rows[0]) : null;
}

export async function listCategories(
  db: Queryable,
  outletId: string,
  opts: { includeInactive: boolean } = { includeInactive: false },
): Promise<Category[]> {
  const { rows } = await db.query<CategoryRow>(
    `SELECT * FROM menu_categories
     WHERE outlet_id = $1 ${opts.includeInactive ? '' : 'AND is_active = TRUE'}
     ORDER BY display_order ASC, name ASC`,
    [outletId],
  );
  return rows.map(mapCategory);
}

export async function updateCategory(
  db: Queryable,
  outletId: string,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    parentId?: string | null;
    displayOrder?: number;
    isActive?: boolean;
  },
): Promise<Category | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(patch.name);
  }
  if (patch.description !== undefined) {
    sets.push(`description = $${i++}`);
    values.push(patch.description);
  }
  if (patch.parentId !== undefined) {
    sets.push(`parent_id = $${i++}`);
    values.push(patch.parentId);
  }
  if (patch.displayOrder !== undefined) {
    sets.push(`display_order = $${i++}`);
    values.push(patch.displayOrder);
  }
  if (patch.isActive !== undefined) {
    sets.push(`is_active = $${i++}`);
    values.push(patch.isActive);
  }
  if (sets.length === 0) {
    return findCategoryById(db, outletId, id);
  }
  values.push(outletId, id);
  const { rows } = await db.query<CategoryRow>(
    `UPDATE menu_categories SET ${sets.join(', ')}
     WHERE outlet_id = $${i++} AND id = $${i}
     RETURNING *`,
    values,
  );
  return rows[0] ? mapCategory(rows[0]) : null;
}

// ============================================================================
// Items
// ============================================================================

interface ItemRow {
  id: string;
  outlet_id: string;
  category_id: string;
  name: string;
  description: string | null;
  price_paise: string; // BIGINT comes back as string from pg by default
  tax_rate_bps: number;
  in_stock: boolean;
  is_active: boolean;
  display_order: number;
  image_url: string | null;
  food_type: string;
  short_code: string | null;
  hsn_code: string | null;
  packing_charge_paise: string; // BIGINT
  online_name: string | null;
  goods_or_services: string;
  allow_decimal_qty: boolean;
  created_at: Date;
  updated_at: Date;
}

interface VariationRow {
  id: string;
  item_id: string;
  name: string;
  price_delta_paise: string;
  display_order: number;
  is_active: boolean;
}

function mapVariation(row: VariationRow): Variation {
  return {
    id: row.id,
    itemId: row.item_id,
    name: row.name,
    priceDeltaPaise: Number(row.price_delta_paise),
    displayOrder: row.display_order,
    isActive: row.is_active,
  };
}

function mapItem(row: ItemRow, variations: Variation[], addons: AddonRef[], addonGroups: AddonGroup[]): Item {
  return {
    id: row.id,
    outletId: row.outlet_id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    pricePaise: Number(row.price_paise),
    taxRateBps: row.tax_rate_bps,
    inStock: row.in_stock,
    isActive: row.is_active,
    displayOrder: row.display_order,
    imageUrl: row.image_url,
    foodType: row.food_type as 'veg' | 'non-veg' | 'egg',
    shortCode: row.short_code,
    hsnCode: row.hsn_code,
    packingChargePaise: Number(row.packing_charge_paise),
    onlineName: row.online_name,
    goodsOrServices: row.goods_or_services as 'goods' | 'services',
    allowDecimalQty: row.allow_decimal_qty,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    variations,
    addons,
    addonGroups,
  };
}

export async function insertItem(
  db: Queryable,
  params: {
    outletId: string;
    categoryId: string;
    name: string;
    description: string | null;
    pricePaise: number;
    taxRateBps: number;
    inStock: boolean;
    displayOrder: number;
    imageUrl: string | null;
    foodType: string;
    shortCode: string | null;
    hsnCode: string | null;
    packingChargePaise: number;
    onlineName: string | null;
    goodsOrServices: string;
    allowDecimalQty: boolean;
  },
): Promise<ItemRow> {
  const { rows } = await db.query<ItemRow>(
    `INSERT INTO menu_items (
       outlet_id, category_id, name, description,
       price_paise, tax_rate_bps, in_stock, display_order, image_url,
       food_type, short_code, hsn_code, packing_charge_paise,
       online_name, goods_or_services, allow_decimal_qty
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING *`,
    [
      params.outletId,
      params.categoryId,
      params.name,
      params.description,
      params.pricePaise,
      params.taxRateBps,
      params.inStock,
      params.displayOrder,
      params.imageUrl,
      params.foodType,
      params.shortCode,
      params.hsnCode,
      params.packingChargePaise,
      params.onlineName,
      params.goodsOrServices,
      params.allowDecimalQty,
    ],
  );
  return rows[0]!;
}

export async function findItemRowById(
  db: Queryable,
  outletId: string,
  id: string,
): Promise<ItemRow | null> {
  const { rows } = await db.query<ItemRow>(
    `SELECT * FROM menu_items WHERE outlet_id = $1 AND id = $2`,
    [outletId, id],
  );
  return rows[0] ?? null;
}

export async function updateItemRow(
  db: Queryable,
  outletId: string,
  id: string,
  patch: {
    categoryId?: string;
    name?: string;
    description?: string | null;
    pricePaise?: number;
    taxRateBps?: number;
    inStock?: boolean;
    isActive?: boolean;
    displayOrder?: number;
    imageUrl?: string | null;
    foodType?: string;
    shortCode?: string | null;
    hsnCode?: string | null;
    packingChargePaise?: number;
    onlineName?: string | null;
    goodsOrServices?: string;
    allowDecimalQty?: boolean;
  },
): Promise<ItemRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const map: Record<string, string> = {
    categoryId: 'category_id',
    name: 'name',
    description: 'description',
    pricePaise: 'price_paise',
    taxRateBps: 'tax_rate_bps',
    inStock: 'in_stock',
    isActive: 'is_active',
    displayOrder: 'display_order',
    imageUrl: 'image_url',
    foodType: 'food_type',
    shortCode: 'short_code',
    hsnCode: 'hsn_code',
    packingChargePaise: 'packing_charge_paise',
    onlineName: 'online_name',
    goodsOrServices: 'goods_or_services',
    allowDecimalQty: 'allow_decimal_qty',
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (patch as Record<string, unknown>)[k];
    if (v !== undefined) {
      sets.push(`${col} = $${i++}`);
      values.push(v);
    }
  }
  if (sets.length === 0) {
    return findItemRowById(db, outletId, id);
  }
  values.push(outletId, id);
  const { rows } = await db.query<ItemRow>(
    `UPDATE menu_items SET ${sets.join(', ')}
     WHERE outlet_id = $${i++} AND id = $${i}
     RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

// ---- Variations (child of item, full-replace semantics) -------------------

export async function listVariationsForItem(
  db: Queryable,
  outletId: string,
  itemId: string,
): Promise<Variation[]> {
  // menu_item_variations has no outlet_id column — ownership is transitive
  // via menu_items. The JOIN+filter is a defense-in-depth guard against
  // being called with an itemId from another outlet (callers normally verify
  // the item first, but the repo should not rely on that).
  const { rows } = await db.query<VariationRow>(
    `SELECT miv.* FROM menu_item_variations miv
       JOIN menu_items mi ON mi.id = miv.item_id
      WHERE mi.outlet_id = $1 AND miv.item_id = $2
      ORDER BY miv.display_order ASC, miv.name ASC`,
    [outletId, itemId],
  );
  return rows.map(mapVariation);
}

export async function replaceVariations(
  db: Queryable,
  outletId: string,
  itemId: string,
  variations: Array<{
    id?: string;
    name: string;
    priceDeltaPaise: number;
    displayOrder: number;
    isActive: boolean;
  }>,
): Promise<Variation[]> {
  // Defense-in-depth: verify the itemId belongs to this outlet before doing
  // any writes. In a correctly-wired service flow the caller (createItem /
  // updateItem) already checked, but the repo must hard-fail on drift so a
  // future caller cannot accidentally smuggle a cross-outlet itemId.
  const { rows: check } = await db.query<{ exists: boolean }>(
    `SELECT TRUE AS exists FROM menu_items WHERE id = $1 AND outlet_id = $2`,
    [itemId, outletId],
  );
  if (check.length === 0) {
    throw new Error(`menu item ${itemId} does not belong to outlet ${outletId}`);
  }

  // Strategy: upsert by (item_id, name), then delete any existing rows whose
  // name is not in the new set. Variation "identity" from the client is by
  // name — if they want to rename, they can delete and re-add.
  // Upsert keeps referential stability for existing rows (no id churn).
  for (const v of variations) {
    await db.query(
      `INSERT INTO menu_item_variations (item_id, name, price_delta_paise, display_order, is_active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (item_id, name) DO UPDATE SET
         price_delta_paise = EXCLUDED.price_delta_paise,
         display_order     = EXCLUDED.display_order,
         is_active         = EXCLUDED.is_active`,
      [itemId, v.name, v.priceDeltaPaise, v.displayOrder, v.isActive],
    );
  }
  const names = variations.map((v) => v.name);
  if (names.length > 0) {
    await db.query(
      `DELETE FROM menu_item_variations
       WHERE item_id = $1 AND name <> ALL($2::text[])`,
      [itemId, names],
    );
  } else {
    await db.query(`DELETE FROM menu_item_variations WHERE item_id = $1`, [itemId]);
  }
  return listVariationsForItem(db, outletId, itemId);
}

// ---- Addons (M2M with items) ----------------------------------------------

interface AddonRow {
  id: string;
  outlet_id: string;
  name: string;
  price_paise: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function mapAddon(row: AddonRow): Addon {
  return {
    id: row.id,
    outletId: row.outlet_id,
    name: row.name,
    pricePaise: Number(row.price_paise),
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAddonRefsForItem(
  db: Queryable,
  itemId: string,
): Promise<AddonRef[]> {
  const { rows } = await db.query<{ id: string; name: string; price_paise: string }>(
    `SELECT a.id, a.name, a.price_paise
     FROM menu_addons a
     JOIN menu_item_addons mia ON mia.addon_id = a.id
     WHERE mia.item_id = $1 AND a.is_active = TRUE
     ORDER BY a.name ASC`,
    [itemId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, pricePaise: Number(r.price_paise) }));
}

export async function replaceItemAddons(
  db: Queryable,
  outletId: string,
  itemId: string,
  addonIds: string[],
): Promise<void> {
  // Defensive outlet check: refuse any addonIds that don't belong to this outlet.
  if (addonIds.length > 0) {
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM menu_addons
       WHERE outlet_id = $1 AND id = ANY($2::uuid[])`,
      [outletId, addonIds],
    );
    if (Number(rows[0]!.count) !== addonIds.length) {
      throw new Error('one or more addonIds do not belong to this outlet');
    }
  }
  await db.query(`DELETE FROM menu_item_addons WHERE item_id = $1`, [itemId]);
  if (addonIds.length > 0) {
    const values = addonIds.map((_, idx) => `($1, $${idx + 2})`).join(', ');
    await db.query(
      `INSERT INTO menu_item_addons (item_id, addon_id) VALUES ${values}`,
      [itemId, ...addonIds],
    );
  }
}

export async function insertAddon(
  db: Queryable,
  params: { outletId: string; name: string; pricePaise: number },
): Promise<Addon> {
  const { rows } = await db.query<AddonRow>(
    `INSERT INTO menu_addons (outlet_id, name, price_paise)
     VALUES ($1, $2, $3) RETURNING *`,
    [params.outletId, params.name, params.pricePaise],
  );
  return mapAddon(rows[0]!);
}

export async function findAddonById(
  db: Queryable,
  outletId: string,
  id: string,
): Promise<Addon | null> {
  const { rows } = await db.query<AddonRow>(
    `SELECT * FROM menu_addons WHERE outlet_id = $1 AND id = $2`,
    [outletId, id],
  );
  return rows[0] ? mapAddon(rows[0]) : null;
}

export async function listAddons(
  db: Queryable,
  outletId: string,
  opts: { includeInactive: boolean } = { includeInactive: false },
): Promise<Addon[]> {
  const { rows } = await db.query<AddonRow>(
    `SELECT * FROM menu_addons
     WHERE outlet_id = $1 ${opts.includeInactive ? '' : 'AND is_active = TRUE'}
     ORDER BY name ASC`,
    [outletId],
  );
  return rows.map(mapAddon);
}

export async function updateAddon(
  db: Queryable,
  outletId: string,
  id: string,
  patch: { name?: string; pricePaise?: number; isActive?: boolean },
): Promise<Addon | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(patch.name);
  }
  if (patch.pricePaise !== undefined) {
    sets.push(`price_paise = $${i++}`);
    values.push(patch.pricePaise);
  }
  if (patch.isActive !== undefined) {
    sets.push(`is_active = $${i++}`);
    values.push(patch.isActive);
  }
  if (sets.length === 0) {
    return findAddonById(db, outletId, id);
  }
  values.push(outletId, id);
  const { rows } = await db.query<AddonRow>(
    `UPDATE menu_addons SET ${sets.join(', ')}
     WHERE outlet_id = $${i++} AND id = $${i}
     RETURNING *`,
    values,
  );
  return rows[0] ? mapAddon(rows[0]) : null;
}

// ============================================================================
// Addon Groups
// ============================================================================

interface AddonGroupRow {
  id: string;
  outlet_id: string;
  name: string;
  selection_type: string;
  min_selections: number;
  max_selections: number;
  is_active: boolean;
  display_order: number;
  created_at: Date;
  updated_at: Date;
}

function mapAddonGroup(row: AddonGroupRow, addons: AddonRef[]): AddonGroup {
  return {
    id: row.id,
    outletId: row.outlet_id,
    name: row.name,
    selectionType: row.selection_type as 'single' | 'multi',
    minSelections: row.min_selections,
    maxSelections: row.max_selections,
    isActive: row.is_active,
    displayOrder: row.display_order,
    addons,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertAddonGroup(
  db: Queryable,
  params: { outletId: string; name: string; selectionType: string; minSelections: number; maxSelections: number },
): Promise<AddonGroupRow> {
  const { rows } = await db.query<AddonGroupRow>(
    `INSERT INTO menu_addon_groups (outlet_id, name, selection_type, min_selections, max_selections)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [params.outletId, params.name, params.selectionType, params.minSelections, params.maxSelections],
  );
  return rows[0]!;
}

export async function findAddonGroupById(
  db: Queryable,
  outletId: string,
  id: string,
): Promise<AddonGroupRow | null> {
  const { rows } = await db.query<AddonGroupRow>(
    `SELECT * FROM menu_addon_groups WHERE outlet_id = $1 AND id = $2`,
    [outletId, id],
  );
  return rows[0] ?? null;
}

export async function listAddonGroupRows(
  db: Queryable,
  outletId: string,
  opts: { includeInactive: boolean } = { includeInactive: false },
): Promise<AddonGroupRow[]> {
  const { rows } = await db.query<AddonGroupRow>(
    `SELECT * FROM menu_addon_groups
     WHERE outlet_id = $1 ${opts.includeInactive ? '' : 'AND is_active = TRUE'}
     ORDER BY display_order ASC, name ASC`,
    [outletId],
  );
  return rows;
}

export async function updateAddonGroup(
  db: Queryable,
  outletId: string,
  id: string,
  patch: {
    name?: string;
    selectionType?: string;
    minSelections?: number;
    maxSelections?: number;
    isActive?: boolean;
  },
): Promise<AddonGroupRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  const map: Record<string, string> = {
    name: 'name',
    selectionType: 'selection_type',
    minSelections: 'min_selections',
    maxSelections: 'max_selections',
    isActive: 'is_active',
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (patch as Record<string, unknown>)[k];
    if (v !== undefined) {
      sets.push(`${col} = $${i++}`);
      values.push(v);
    }
  }
  if (sets.length === 0) {
    return findAddonGroupById(db, outletId, id);
  }
  values.push(outletId, id);
  const { rows } = await db.query<AddonGroupRow>(
    `UPDATE menu_addon_groups SET ${sets.join(', ')}
     WHERE outlet_id = $${i++} AND id = $${i}
     RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

export async function replaceAddonGroupAddons(
  db: Queryable,
  outletId: string,
  groupId: string,
  addonIds: string[],
): Promise<void> {
  // Validate all addonIds belong to this outlet
  if (addonIds.length > 0) {
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM menu_addons
       WHERE outlet_id = $1 AND id = ANY($2::uuid[])`,
      [outletId, addonIds],
    );
    if (Number(rows[0]!.count) !== addonIds.length) {
      throw new Error('one or more addonIds do not belong to this outlet');
    }
  }
  // Remove all addons from this group
  await db.query(`UPDATE menu_addons SET addon_group_id = NULL WHERE addon_group_id = $1`, [groupId]);
  // Assign the new set
  if (addonIds.length > 0) {
    await db.query(
      `UPDATE menu_addons SET addon_group_id = $1 WHERE id = ANY($2::uuid[])`,
      [groupId, addonIds],
    );
  }
}

export async function listAddonRefsForGroup(
  db: Queryable,
  groupId: string,
): Promise<AddonRef[]> {
  const { rows } = await db.query<{ id: string; name: string; price_paise: string }>(
    `SELECT id, name, price_paise FROM menu_addons
     WHERE addon_group_id = $1 AND is_active = TRUE
     ORDER BY name ASC`,
    [groupId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, pricePaise: Number(r.price_paise) }));
}

export async function hydrateAddonGroup(db: Queryable, row: AddonGroupRow): Promise<AddonGroup> {
  const addons = await listAddonRefsForGroup(db, row.id);
  return mapAddonGroup(row, addons);
}

export async function listAddonGroups(
  db: Queryable,
  outletId: string,
  opts: { includeInactive: boolean } = { includeInactive: false },
): Promise<AddonGroup[]> {
  const rows = await listAddonGroupRows(db, outletId, opts);
  return Promise.all(rows.map((r) => hydrateAddonGroup(db, r)));
}

export async function replaceItemAddonGroups(
  db: Queryable,
  outletId: string,
  itemId: string,
  addonGroupIds: string[],
): Promise<void> {
  // Validate all addonGroupIds belong to this outlet
  if (addonGroupIds.length > 0) {
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM menu_addon_groups
       WHERE outlet_id = $1 AND id = ANY($2::uuid[])`,
      [outletId, addonGroupIds],
    );
    if (Number(rows[0]!.count) !== addonGroupIds.length) {
      throw new Error('one or more addonGroupIds do not belong to this outlet');
    }
  }
  await db.query(`DELETE FROM menu_item_addon_groups WHERE item_id = $1`, [itemId]);
  if (addonGroupIds.length > 0) {
    const values = addonGroupIds.map((_, idx) => `($1, $${idx + 2})`).join(', ');
    await db.query(
      `INSERT INTO menu_item_addon_groups (item_id, addon_group_id) VALUES ${values}`,
      [itemId, ...addonGroupIds],
    );
  }
}

export async function listAddonGroupsForItem(
  db: Queryable,
  itemId: string,
): Promise<AddonGroup[]> {
  const { rows } = await db.query<AddonGroupRow>(
    `SELECT ag.* FROM menu_addon_groups ag
     JOIN menu_item_addon_groups miag ON miag.addon_group_id = ag.id
     WHERE miag.item_id = $1 AND ag.is_active = TRUE
     ORDER BY ag.display_order ASC, ag.name ASC`,
    [itemId],
  );
  return Promise.all(rows.map((r) => hydrateAddonGroup(db, r)));
}

// ============================================================================
// Full-item hydration + service menu query
// ============================================================================

export async function hydrateItem(db: Queryable, row: ItemRow): Promise<Item> {
  // row.outlet_id came from the outlet-scoped item lookup, so threading it
  // down into listVariationsForItem keeps the variations query scoped too.
  const [variations, addons, addonGroups] = await Promise.all([
    listVariationsForItem(db, row.outlet_id, row.id),
    listAddonRefsForItem(db, row.id),
    listAddonGroupsForItem(db, row.id),
  ]);
  return mapItem(row, variations, addons, addonGroups);
}

export async function listItems(
  db: Queryable,
  outletId: string,
  opts: { categoryId?: string; includeInactive: boolean } = { includeInactive: false },
): Promise<Item[]> {
  const conditions = ['outlet_id = $1'];
  const values: unknown[] = [outletId];
  if (!opts.includeInactive) conditions.push('is_active = TRUE');
  if (opts.categoryId) {
    values.push(opts.categoryId);
    conditions.push(`category_id = $${values.length}`);
  }
  const { rows } = await db.query<ItemRow>(
    `SELECT * FROM menu_items WHERE ${conditions.join(' AND ')}
     ORDER BY display_order ASC, name ASC`,
    values,
  );
  // Hydrate variations and addons in parallel. For v1 catalog sizes this is
  // fine; if item counts grow past a few hundred, switch to a two-query fetch
  // (items, then variations + addons in batch by item_id IN (...)).
  return Promise.all(rows.map((r) => hydrateItem(db, r)));
}

/**
 * The query the POS calls to render its menu grid. Returns active
 * categories with their active items (including variations and addons)
 * in display order, in one payload.
 */
export async function getServiceMenu(db: Queryable, outletId: string): Promise<ServiceMenu> {
  const categories = await listCategories(db, outletId, { includeInactive: false });
  const items = await listItems(db, outletId, { includeInactive: false });
  const byCategory = new Map<string, Item[]>();
  for (const item of items) {
    const list = byCategory.get(item.categoryId) ?? [];
    list.push(item);
    byCategory.set(item.categoryId, list);
  }
  return categories.map<ServiceMenuCategory>((c) => ({
    ...c,
    items: byCategory.get(c.id) ?? [],
  }));
}
