import type { Queryable } from '../../db/index.js';
import type {
  Kot,
  KotStatus,
  Order,
  OrderItem,
  OrderItemAddon,
  OrderStatus,
  OrderType,
} from './orders.types.js';

// ---- row shapes -------------------------------------------------------------

interface OrderRow {
  id: string;
  outlet_id: string;
  order_number: string;
  order_type: OrderType;
  table_id: string | null;
  status: OrderStatus;
  customer_name: string | null;
  customer_phone: string | null;
  pax: number | null;
  notes: string | null;
  opened_by: string;
  opened_at: Date;
  closed_at: Date | null;
  cancelled_at: Date | null;
  cancelled_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

interface KotRow {
  id: string;
  outlet_id: string;
  order_id: string;
  kot_number: string;
  status: KotStatus;
  sent_by: string;
  sent_at: Date;
  started_at: Date | null;
  ready_at: Date | null;
  served_at: Date | null;
  voided_at: Date | null;
  void_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

interface OrderItemRow {
  id: string;
  outlet_id: string;
  order_id: string;
  kot_id: string | null;
  menu_item_id: string;
  menu_item_name: string;
  variation_id: string | null;
  variation_name: string | null;
  unit_price_paise: string;
  tax_rate_bps: number;
  addons: OrderItemAddon[] | null;
  quantity: number;
  notes: string | null;
  is_void: boolean;
  void_reason: string | null;
  voided_at: Date | null;
  voided_by: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

// ---- mappers ----------------------------------------------------------------

function mapOrder(row: OrderRow): Order {
  return {
    id: row.id,
    outletId: row.outlet_id,
    orderNumber: Number(row.order_number),
    orderType: row.order_type,
    tableId: row.table_id,
    status: row.status,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    pax: row.pax,
    notes: row.notes,
    openedBy: row.opened_by,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    cancelledAt: row.cancelled_at,
    cancelledReason: row.cancelled_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapKot(row: KotRow): Kot {
  return {
    id: row.id,
    outletId: row.outlet_id,
    orderId: row.order_id,
    kotNumber: Number(row.kot_number),
    status: row.status,
    sentBy: row.sent_by,
    sentAt: row.sent_at,
    startedAt: row.started_at,
    readyAt: row.ready_at,
    servedAt: row.served_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOrderItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    outletId: row.outlet_id,
    orderId: row.order_id,
    kotId: row.kot_id,
    menuItemId: row.menu_item_id,
    menuItemName: row.menu_item_name,
    variationId: row.variation_id,
    variationName: row.variation_name,
    unitPricePaise: Number(row.unit_price_paise),
    taxRateBps: row.tax_rate_bps,
    addons: (row.addons ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      pricePaise: Number(a.pricePaise),
    })),
    quantity: row.quantity,
    notes: row.notes,
    isVoid: row.is_void,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---- menu snapshot lookup (used at insert time) -----------------------------

export interface MenuItemSnapshot {
  id: string;
  name: string;
  basePricePaise: number;
  taxRateBps: number;
}

export interface VariationSnapshot {
  id: string;
  itemId: string;
  name: string;
  priceDeltaPaise: number;
}

export interface AddonSnapshot {
  id: string;
  name: string;
  pricePaise: number;
}

/**
 * Fetch the current menu state for every (menuItemId, variationId?) pair
 * that's about to be inserted as an order_item. Called inside the order
 * creation transaction so pricing is consistent. Outlet-scoped — trying to
 * reference another outlet's menu item will silently drop it (caller must
 * detect missing ids and 400).
 */
export async function loadMenuSnapshots(
  db: Queryable,
  outletId: string,
  menuItemIds: string[],
): Promise<Map<string, MenuItemSnapshot>> {
  if (menuItemIds.length === 0) return new Map();
  const { rows } = await db.query<{
    id: string;
    name: string;
    price_paise: string;
    tax_rate_bps: number;
  }>(
    `SELECT id, name, price_paise, tax_rate_bps
       FROM menu_items
      WHERE outlet_id = $1 AND id = ANY($2::uuid[]) AND is_active = TRUE`,
    [outletId, menuItemIds],
  );
  const out = new Map<string, MenuItemSnapshot>();
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      name: r.name,
      basePricePaise: Number(r.price_paise),
      taxRateBps: r.tax_rate_bps,
    });
  }
  return out;
}

export async function loadVariationSnapshots(
  db: Queryable,
  outletId: string,
  variationIds: string[],
): Promise<Map<string, VariationSnapshot>> {
  if (variationIds.length === 0) return new Map();
  // menu_item_variations has no outlet_id column of its own — ownership is
  // transitive via its parent menu_items row. We JOIN back to menu_items
  // and filter by outlet so a client cannot snapshot a variation from
  // another tenant's menu during order creation, even if they know the
  // UUID. The service layer also cross-checks v.itemId against the
  // submitted menuItemId, but that's a secondary guard — the repository
  // must not return cross-outlet rows in the first place.
  const { rows } = await db.query<{
    id: string;
    item_id: string;
    name: string;
    price_delta_paise: string;
  }>(
    `SELECT miv.id, miv.item_id, miv.name, miv.price_delta_paise
       FROM menu_item_variations miv
       JOIN menu_items mi ON mi.id = miv.item_id
      WHERE mi.outlet_id = $1
        AND miv.id = ANY($2::uuid[])
        AND miv.is_active = TRUE`,
    [outletId, variationIds],
  );
  const out = new Map<string, VariationSnapshot>();
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      itemId: r.item_id,
      name: r.name,
      priceDeltaPaise: Number(r.price_delta_paise),
    });
  }
  return out;
}

export async function loadAddonSnapshots(
  db: Queryable,
  outletId: string,
  addonIds: string[],
): Promise<Map<string, AddonSnapshot>> {
  if (addonIds.length === 0) return new Map();
  const { rows } = await db.query<{
    id: string;
    name: string;
    price_paise: string;
  }>(
    `SELECT id, name, price_paise
       FROM menu_addons
      WHERE outlet_id = $1 AND id = ANY($2::uuid[]) AND is_active = TRUE`,
    [outletId, addonIds],
  );
  const out = new Map<string, AddonSnapshot>();
  for (const r of rows) {
    out.set(r.id, { id: r.id, name: r.name, pricePaise: Number(r.price_paise) });
  }
  return out;
}

/**
 * Returns the set of addonIds that are NOT allowed for the given menu item
 * (based on the menu_item_addons join). Used to reject cross-item addons.
 */
export async function filterAllowedAddons(
  db: Queryable,
  menuItemId: string,
  addonIds: string[],
): Promise<Set<string>> {
  if (addonIds.length === 0) return new Set();
  const { rows } = await db.query<{ addon_id: string }>(
    `SELECT addon_id FROM menu_item_addons
      WHERE item_id = $1 AND addon_id = ANY($2::uuid[])`,
    [menuItemId, addonIds],
  );
  return new Set(rows.map((r) => r.addon_id));
}

/** Confirms a dining table belongs to this outlet and is active. */
export async function findActiveTable(
  db: Queryable,
  outletId: string,
  tableId: string,
): Promise<{ id: string; code: string } | null> {
  const { rows } = await db.query<{ id: string; code: string }>(
    `SELECT id, code FROM dining_tables
      WHERE outlet_id = $1 AND id = $2 AND is_active = TRUE`,
    [outletId, tableId],
  );
  return rows[0] ?? null;
}

// ---- order CRUD -------------------------------------------------------------

export async function insertOrder(
  db: Queryable,
  params: {
    outletId: string;
    orderType: OrderType;
    tableId: string | null;
    customerName: string | null;
    customerPhone: string | null;
    pax: number | null;
    notes: string | null;
    openedBy: string;
  },
): Promise<Order> {
  const { rows } = await db.query<OrderRow>(
    `INSERT INTO orders
       (outlet_id, order_type, table_id, customer_name, customer_phone, pax, notes, opened_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      params.outletId,
      params.orderType,
      params.tableId,
      params.customerName,
      params.customerPhone,
      params.pax,
      params.notes,
      params.openedBy,
    ],
  );
  return mapOrder(rows[0]!);
}

export async function findOrderById(
  db: Queryable,
  outletId: string,
  id: string,
): Promise<Order | null> {
  const { rows } = await db.query<OrderRow>(
    `SELECT * FROM orders WHERE outlet_id = $1 AND id = $2`,
    [outletId, id],
  );
  return rows[0] ? mapOrder(rows[0]) : null;
}

export async function listOrders(
  db: Queryable,
  outletId: string,
  opts: { status?: OrderStatus; tableId?: string } = {},
): Promise<Order[]> {
  const conds = ['outlet_id = $1'];
  const values: unknown[] = [outletId];
  if (opts.status) {
    values.push(opts.status);
    conds.push(`status = $${values.length}`);
  }
  if (opts.tableId) {
    values.push(opts.tableId);
    conds.push(`table_id = $${values.length}`);
  }
  const { rows } = await db.query<OrderRow>(
    `SELECT * FROM orders WHERE ${conds.join(' AND ')}
     ORDER BY opened_at DESC`,
    values,
  );
  return rows.map(mapOrder);
}

export async function markOrderCancelled(
  db: Queryable,
  outletId: string,
  id: string,
  reason: string,
): Promise<Order | null> {
  const { rows } = await db.query<OrderRow>(
    `UPDATE orders
        SET status = 'cancelled',
            cancelled_at = NOW(),
            cancelled_reason = $3
      WHERE outlet_id = $1 AND id = $2 AND status = 'open'
      RETURNING *`,
    [outletId, id, reason],
  );
  return rows[0] ? mapOrder(rows[0]) : null;
}

// ---- order items ------------------------------------------------------------

export async function insertOrderItem(
  db: Queryable,
  params: {
    outletId: string;
    orderId: string;
    menuItemId: string;
    menuItemName: string;
    variationId: string | null;
    variationName: string | null;
    unitPricePaise: number;
    taxRateBps: number;
    addons: OrderItemAddon[];
    quantity: number;
    notes: string | null;
    createdBy: string;
  },
): Promise<OrderItem> {
  const { rows } = await db.query<OrderItemRow>(
    `INSERT INTO order_items
       (outlet_id, order_id, menu_item_id, menu_item_name,
        variation_id, variation_name, unit_price_paise, tax_rate_bps,
        addons, quantity, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
     RETURNING *`,
    [
      params.outletId,
      params.orderId,
      params.menuItemId,
      params.menuItemName,
      params.variationId,
      params.variationName,
      params.unitPricePaise,
      params.taxRateBps,
      JSON.stringify(params.addons),
      params.quantity,
      params.notes,
      params.createdBy,
    ],
  );
  return mapOrderItem(rows[0]!);
}

export async function findOrderItemById(
  db: Queryable,
  outletId: string,
  id: string,
): Promise<OrderItem | null> {
  const { rows } = await db.query<OrderItemRow>(
    `SELECT * FROM order_items WHERE outlet_id = $1 AND id = $2`,
    [outletId, id],
  );
  return rows[0] ? mapOrderItem(rows[0]) : null;
}

export async function listOrderItems(
  db: Queryable,
  outletId: string,
  orderId: string,
): Promise<OrderItem[]> {
  const { rows } = await db.query<OrderItemRow>(
    `SELECT * FROM order_items
      WHERE outlet_id = $1 AND order_id = $2
      ORDER BY created_at ASC`,
    [outletId, orderId],
  );
  return rows.map(mapOrderItem);
}

export async function listDraftOrderItems(
  db: Queryable,
  outletId: string,
  orderId: string,
): Promise<OrderItem[]> {
  const { rows } = await db.query<OrderItemRow>(
    `SELECT * FROM order_items
      WHERE outlet_id = $1 AND order_id = $2
        AND kot_id IS NULL AND is_void = FALSE
      ORDER BY created_at ASC`,
    [outletId, orderId],
  );
  return rows.map(mapOrderItem);
}

/**
 * Same as listDraftOrderItems but acquires row-level locks (`FOR UPDATE`)
 * for the duration of the current transaction. MUST be called inside a
 * `withTransaction` — otherwise the lock is released immediately and the
 * call is pointless.
 *
 * Used by the "send to kitchen" flow so that two staff hitting the button
 * on the same order at the same time cannot both observe the same draft
 * items, each insert a KOT, and race the UPDATE. Without this lock the
 * loser of the race silently creates an empty phantom KOT: its SELECT sees
 * the drafts, it inserts a KOT row, then its UPDATE re-reads the rows
 * under READ COMMITTED and finds `kot_id IS NOT NULL` (the winner already
 * claimed them), so it updates zero rows. The phantom KOT still gets
 * broadcast to KDS and poisons the ticket count.
 *
 * With FOR UPDATE the loser blocks at the SELECT stage, then sees zero
 * drafts after the winner commits and throws BadRequest cleanly before
 * inserting anything.
 */
export async function lockDraftOrderItems(
  db: Queryable,
  outletId: string,
  orderId: string,
): Promise<OrderItem[]> {
  const { rows } = await db.query<OrderItemRow>(
    `SELECT * FROM order_items
      WHERE outlet_id = $1 AND order_id = $2
        AND kot_id IS NULL AND is_void = FALSE
      ORDER BY created_at ASC
      FOR UPDATE`,
    [outletId, orderId],
  );
  return rows.map(mapOrderItem);
}

export async function listKotItems(
  db: Queryable,
  outletId: string,
  kotId: string,
): Promise<OrderItem[]> {
  const { rows } = await db.query<OrderItemRow>(
    `SELECT * FROM order_items
      WHERE outlet_id = $1 AND kot_id = $2
      ORDER BY created_at ASC`,
    [outletId, kotId],
  );
  return rows.map(mapOrderItem);
}

export async function assignItemsToKot(
  db: Queryable,
  outletId: string,
  orderId: string,
  kotId: string,
): Promise<OrderItem[]> {
  const { rows } = await db.query<OrderItemRow>(
    `UPDATE order_items
        SET kot_id = $3
      WHERE outlet_id = $1 AND order_id = $2
        AND kot_id IS NULL AND is_void = FALSE
      RETURNING *`,
    [outletId, orderId, kotId],
  );
  return rows.map(mapOrderItem);
}

export async function voidOrderItem(
  db: Queryable,
  outletId: string,
  id: string,
  reason: string,
  voidedBy: string,
): Promise<OrderItem | null> {
  const { rows } = await db.query<OrderItemRow>(
    `UPDATE order_items
        SET is_void = TRUE,
            void_reason = $3,
            voided_at = NOW(),
            voided_by = $4
      WHERE outlet_id = $1 AND id = $2 AND is_void = FALSE
      RETURNING *`,
    [outletId, id, reason, voidedBy],
  );
  return rows[0] ? mapOrderItem(rows[0]) : null;
}

// ---- kots -------------------------------------------------------------------

export async function insertKot(
  db: Queryable,
  params: { outletId: string; orderId: string; sentBy: string },
): Promise<Kot> {
  const { rows } = await db.query<KotRow>(
    `INSERT INTO kots (outlet_id, order_id, sent_by)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [params.outletId, params.orderId, params.sentBy],
  );
  return mapKot(rows[0]!);
}

export async function findKotById(
  db: Queryable,
  outletId: string,
  id: string,
): Promise<Kot | null> {
  const { rows } = await db.query<KotRow>(
    `SELECT * FROM kots WHERE outlet_id = $1 AND id = $2`,
    [outletId, id],
  );
  return rows[0] ? mapKot(rows[0]) : null;
}

export async function listKots(
  db: Queryable,
  outletId: string,
  opts: { status?: KotStatus; active?: boolean } = {},
): Promise<Kot[]> {
  const conds = ['outlet_id = $1'];
  const values: unknown[] = [outletId];
  if (opts.active) {
    conds.push(`status IN ('new','in_progress','ready')`);
  } else if (opts.status) {
    values.push(opts.status);
    conds.push(`status = $${values.length}`);
  }
  const { rows } = await db.query<KotRow>(
    `SELECT * FROM kots WHERE ${conds.join(' AND ')}
     ORDER BY sent_at ASC`,
    values,
  );
  return rows.map(mapKot);
}

export async function listKotsForOrder(
  db: Queryable,
  outletId: string,
  orderId: string,
): Promise<Kot[]> {
  const { rows } = await db.query<KotRow>(
    `SELECT * FROM kots
      WHERE outlet_id = $1 AND order_id = $2
      ORDER BY sent_at ASC`,
    [outletId, orderId],
  );
  return rows.map(mapKot);
}

/**
 * Transition a KOT to a new status, setting the matching timestamp and
 * enforcing allowed transitions in SQL so two racing requests can't skip
 * states. Returns null if the row wasn't in a state that allows the target.
 */
export async function transitionKotStatus(
  db: Queryable,
  outletId: string,
  id: string,
  target: KotStatus,
  reason: string | null,
): Promise<Kot | null> {
  const allowedFrom: Record<KotStatus, KotStatus[]> = {
    new: [],
    in_progress: ['new'],
    ready: ['new', 'in_progress'],
    served: ['ready'],
    void: ['new', 'in_progress', 'ready'],
  };
  const from = allowedFrom[target];
  if (from.length === 0) return null;

  const timestampCol: Record<Exclude<KotStatus, 'new'>, string> = {
    in_progress: 'started_at',
    ready: 'ready_at',
    served: 'served_at',
    void: 'voided_at',
  };
  const ts = timestampCol[target as Exclude<KotStatus, 'new'>];

  // $3 is typed both as kot_status (SET) and text (CASE comparison). Postgres
  // refuses to infer a single type for a bound parameter used two ways — error
  // 42P08 "ambiguous parameter". Cast explicitly on both sides.
  const sql = `
    UPDATE kots
       SET status = $3::kot_status,
           ${ts} = COALESCE(${ts}, NOW()),
           void_reason = CASE WHEN $3::text = 'void' THEN $4 ELSE void_reason END
     WHERE outlet_id = $1 AND id = $2 AND status = ANY($5::kot_status[])
     RETURNING *`;
  const { rows } = await db.query<KotRow>(sql, [outletId, id, target, reason, from]);
  return rows[0] ? mapKot(rows[0]) : null;
}

/** Void every non-void item under a KOT. Used when the whole KOT is voided. */
export async function voidItemsForKot(
  db: Queryable,
  outletId: string,
  kotId: string,
  reason: string,
  voidedBy: string,
): Promise<void> {
  await db.query(
    `UPDATE order_items
        SET is_void = TRUE,
            void_reason = $3,
            voided_at = NOW(),
            voided_by = $4
      WHERE outlet_id = $1 AND kot_id = $2 AND is_void = FALSE`,
    [outletId, kotId, reason, voidedBy],
  );
}

/** Used by KDS hydration: resolve (orderId → order header) for a batch of KOTs. */
export async function loadOrderHeadersForKots(
  db: Queryable,
  outletId: string,
  orderIds: string[],
): Promise<
  Map<
    string,
    { id: string; orderNumber: number; orderType: OrderType; tableId: string | null; tableCode: string | null }
  >
> {
  if (orderIds.length === 0) return new Map();
  const { rows } = await db.query<{
    id: string;
    order_number: string;
    order_type: OrderType;
    table_id: string | null;
    table_code: string | null;
  }>(
    `SELECT o.id, o.order_number, o.order_type, o.table_id, t.code AS table_code
       FROM orders o
       LEFT JOIN dining_tables t ON t.id = o.table_id
      WHERE o.outlet_id = $1 AND o.id = ANY($2::uuid[])`,
    [outletId, orderIds],
  );
  const out = new Map<
    string,
    { id: string; orderNumber: number; orderType: OrderType; tableId: string | null; tableCode: string | null }
  >();
  for (const r of rows) {
    out.set(r.id, {
      id: r.id,
      orderNumber: Number(r.order_number),
      orderType: r.order_type,
      tableId: r.table_id,
      tableCode: r.table_code,
    });
  }
  return out;
}
