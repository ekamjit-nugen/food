import { pool, withTransaction } from '../../db/index.js';
import type { AuthContext } from '../../middleware/auth.js';
import { writeAudit } from '../../middleware/audit.js';
import { AppError, BadRequest, Conflict, ErrorCode, NotFound } from '../../utils/errors.js';
import * as repo from './orders.repository.js';
import type {
  AddOrderItemsInput,
  CancelOrderInput,
  CreateOrderInput,
  DraftOrderItemInput,
  UpdateKotStatusInput,
  VoidOrderItemInput,
} from './orders.schemas.js';
import type {
  Kot,
  KotStatus,
  KotWithItems,
  Order,
  OrderDetail,
  OrderItem,
  OrderItemAddon,
} from './orders.types.js';
import { broadcastKds, type KdsEvent } from '../../ws/kds.js';

interface AuditMeta {
  requestId?: string;
  ipAddress?: string;
}

// ---- create / read ----------------------------------------------------------

export async function createOrder(
  actor: AuthContext,
  input: CreateOrderInput,
  meta: AuditMeta = {},
): Promise<OrderDetail> {
  return withTransaction(async (tx) => {
    // Validate table ownership + active state for dine_in.
    if (input.orderType === 'dine_in' && input.tableId) {
      const t = await repo.findActiveTable(tx, actor.outletId, input.tableId);
      if (!t) throw NotFound('dining table', input.tableId);
    }

    let order: Order;
    try {
      order = await repo.insertOrder(tx, {
        outletId: actor.outletId,
        orderType: input.orderType,
        tableId: input.tableId ?? null,
        customerName: input.customerName ?? null,
        customerPhone: input.customerPhone ?? null,
        pax: input.pax ?? null,
        notes: input.notes ?? null,
        openedBy: actor.userId,
      });
    } catch (err) {
      // Unique partial index on (table_id) WHERE status='open'.
      const e = err as { code?: string; constraint?: string };
      if (e?.code === '23505' && e.constraint === 'uniq_orders_one_open_per_table') {
        throw Conflict('this table already has an open order');
      }
      throw err;
    }

    const items: OrderItem[] = input.items?.length
      ? await insertResolvedItems(tx, actor, order.id, input.items)
      : [];

    await writeAudit(tx, {
      actor,
      entityType: 'order',
      entityId: order.id,
      action: 'create',
      after: { ...order, itemCount: items.length },
      ...meta,
    });

    return { ...order, items, kots: [] };
  });
}

export async function listOrders(
  actor: AuthContext,
  opts: { status?: 'open' | 'closed' | 'cancelled'; tableId?: string } = {},
): Promise<Order[]> {
  return repo.listOrders(pool, actor.outletId, opts);
}

export async function getOrderDetail(
  actor: AuthContext,
  id: string,
): Promise<OrderDetail> {
  const order = await repo.findOrderById(pool, actor.outletId, id);
  if (!order) throw NotFound('order', id);
  const [items, kots] = await Promise.all([
    repo.listOrderItems(pool, actor.outletId, id),
    repo.listKotsForOrder(pool, actor.outletId, id),
  ]);
  return { ...order, items, kots };
}

// ---- draft items ------------------------------------------------------------

export async function addOrderItems(
  actor: AuthContext,
  orderId: string,
  input: AddOrderItemsInput,
  meta: AuditMeta = {},
): Promise<OrderItem[]> {
  return withTransaction(async (tx) => {
    const order = await repo.findOrderById(tx, actor.outletId, orderId);
    if (!order) throw NotFound('order', orderId);
    if (order.status !== 'open') {
      throw new AppError({ statusCode: 409, code: ErrorCode.ORDER_NOT_OPEN, message: 'This order is not open' });
    }
    const items = await insertResolvedItems(tx, actor, orderId, input.items);
    await writeAudit(tx, {
      actor,
      entityType: 'order',
      entityId: orderId,
      action: 'update',
      after: { added: items.map((i) => i.id), count: items.length },
      ...meta,
    });
    return items;
  });
}

/**
 * Resolve draft items against the current menu, snapshot pricing, insert rows.
 *
 * All validation that depends on the menu happens here so both createOrder and
 * addOrderItems go through a single source of truth for pricing. NEVER trust
 * a price that came from the client.
 */
async function insertResolvedItems(
  tx: Parameters<typeof repo.insertOrder>[0],
  actor: AuthContext,
  orderId: string,
  drafts: DraftOrderItemInput[],
): Promise<OrderItem[]> {
  const menuItemIds = [...new Set(drafts.map((d) => d.menuItemId))];
  const variationIds = [...new Set(drafts.map((d) => d.variationId).filter(Boolean) as string[])];
  const addonIds = [...new Set(drafts.flatMap((d) => d.addonIds))];

  const [menu, variations, addons] = await Promise.all([
    repo.loadMenuSnapshots(tx, actor.outletId, menuItemIds),
    repo.loadVariationSnapshots(tx, actor.outletId, variationIds),
    repo.loadAddonSnapshots(tx, actor.outletId, addonIds),
  ]);

  // Validate every reference before we touch the DB.
  for (const d of drafts) {
    const item = menu.get(d.menuItemId);
    if (!item) throw BadRequest(`menu item not found or inactive: ${d.menuItemId}`);
    if (d.variationId) {
      const v = variations.get(d.variationId);
      if (!v) throw BadRequest(`variation not found or inactive: ${d.variationId}`);
      if (v.itemId !== d.menuItemId) {
        throw BadRequest(`variation ${d.variationId} does not belong to item ${d.menuItemId}`);
      }
    }
    for (const aid of d.addonIds) {
      if (!addons.has(aid)) throw BadRequest(`addon not found or inactive: ${aid}`);
    }
    if (d.addonIds.length > 0) {
      const allowed = await repo.filterAllowedAddons(tx, d.menuItemId, d.addonIds);
      for (const aid of d.addonIds) {
        if (!allowed.has(aid)) {
          throw BadRequest(`addon ${aid} is not allowed on item ${d.menuItemId}`);
        }
      }
    }
  }

  const out: OrderItem[] = [];
  for (const d of drafts) {
    const item = menu.get(d.menuItemId)!;
    const v = d.variationId ? variations.get(d.variationId)! : null;
    const unitPricePaise = item.basePricePaise + (v?.priceDeltaPaise ?? 0);
    if (unitPricePaise < 0) {
      // Defensive: negative deltas shouldn't exceed the base. Catch misconfig.
      throw BadRequest(`computed unit price is negative for item ${item.id}`);
    }
    const addonSnap: OrderItemAddon[] = d.addonIds.map((aid) => {
      const a = addons.get(aid)!;
      return { id: a.id, name: a.name, pricePaise: a.pricePaise };
    });
    const inserted = await repo.insertOrderItem(tx, {
      outletId: actor.outletId,
      orderId,
      menuItemId: item.id,
      menuItemName: item.name,
      variationId: v?.id ?? null,
      variationName: v?.name ?? null,
      unitPricePaise,
      taxRateBps: item.taxRateBps,
      addons: addonSnap,
      quantity: d.quantity,
      notes: d.notes ?? null,
      createdBy: actor.userId,
    });
    out.push(inserted);
  }
  return out;
}

// ---- send to kitchen --------------------------------------------------------

/**
 * Create a KOT from all current draft items on the order and broadcast to KDS.
 * No drafts = 400 (no silent no-op; the POS should hide the button when empty).
 */
export async function sendDraftItemsToKitchen(
  actor: AuthContext,
  orderId: string,
  meta: AuditMeta = {},
): Promise<KotWithItems> {
  const result = await withTransaction(async (tx) => {
    const order = await repo.findOrderById(tx, actor.outletId, orderId);
    if (!order) throw NotFound('order', orderId);
    if (order.status !== 'open') {
      throw new AppError({ statusCode: 409, code: ErrorCode.ORDER_NOT_OPEN, message: 'This order is not open' });
    }

    // FOR UPDATE: block concurrent "send to kitchen" callers on the same
    // order so only one transaction can claim a given set of draft items.
    // See lockDraftOrderItems for the ghost-KOT race this prevents.
    const drafts = await repo.lockDraftOrderItems(tx, actor.outletId, orderId);
    if (drafts.length === 0) {
      throw BadRequest('no draft items to send');
    }

    const kot = await repo.insertKot(tx, {
      outletId: actor.outletId,
      orderId,
      sentBy: actor.userId,
    });
    const assigned = await repo.assignItemsToKot(tx, actor.outletId, orderId, kot.id);

    // Belt-and-braces: if somehow fewer items were assigned than locked,
    // another transaction slipped through — abort rather than create a
    // partial KOT.
    if (assigned.length !== drafts.length) {
      throw Conflict('draft items changed during send — retry');
    }

    await writeAudit(tx, {
      actor,
      entityType: 'kot',
      entityId: kot.id,
      action: 'create',
      after: {
        orderId,
        kotNumber: kot.kotNumber,
        itemCount: assigned.length,
        itemIds: assigned.map((i) => i.id),
      },
      ...meta,
    });

    return { kot, items: assigned, order };
  });

  const hydrated = await hydrateKot(result.kot, result.items);
  emitKds({ type: 'kot.created', kot: hydrated });
  return hydrated;
}

// ---- kot state transitions --------------------------------------------------

export async function updateKotStatus(
  actor: AuthContext,
  kotId: string,
  input: UpdateKotStatusInput,
  meta: AuditMeta = {},
): Promise<KotWithItems> {
  const hydrated = await withTransaction(async (tx) => {
    const before = await repo.findKotById(tx, actor.outletId, kotId);
    if (!before) throw NotFound('kot', kotId);

    const target: KotStatus = input.status;
    const after = await repo.transitionKotStatus(
      tx,
      actor.outletId,
      kotId,
      target,
      input.reason ?? null,
    );
    if (!after) {
      throw new AppError({ statusCode: 409, code: ErrorCode.INVALID_KOT_TRANSITION, message: `This KOT status change is not allowed (${before.status} → ${target})` });
    }

    if (target === 'void') {
      await repo.voidItemsForKot(
        tx,
        actor.outletId,
        kotId,
        input.reason ?? 'kot voided',
        actor.userId,
      );
    }

    const items = await repo.listKotItems(tx, actor.outletId, kotId);

    await writeAudit(tx, {
      actor,
      entityType: 'kot',
      entityId: kotId,
      action: target === 'void' ? 'delete' : 'update',
      before,
      after,
      ...meta,
    });

    return hydrateKot(after, items);
  });

  emitKds({ type: 'kot.updated', kot: hydrated });
  return hydrated;
}

// ---- void individual item ---------------------------------------------------

export async function voidOrderItem(
  actor: AuthContext,
  orderId: string,
  itemId: string,
  input: VoidOrderItemInput,
  meta: AuditMeta = {},
): Promise<OrderItem> {
  const { item, kot } = await withTransaction(async (tx) => {
    const existing = await repo.findOrderItemById(tx, actor.outletId, itemId);
    if (!existing || existing.orderId !== orderId) {
      throw NotFound('order item', itemId);
    }
    if (existing.isVoid) {
      throw Conflict('item is already void');
    }
    const voided = await repo.voidOrderItem(
      tx,
      actor.outletId,
      itemId,
      input.reason,
      actor.userId,
    );
    if (!voided) throw Conflict('item could not be voided');

    await writeAudit(tx, {
      actor,
      entityType: 'order_item',
      entityId: itemId,
      action: 'delete',
      before: existing,
      after: voided,
      ...meta,
    });

    // If the item was already on a KOT, the kitchen needs to know.
    let kot: Kot | null = null;
    if (voided.kotId) {
      kot = await repo.findKotById(tx, actor.outletId, voided.kotId);
    }
    return { item: voided, kot };
  });

  if (kot) {
    const items = await repo.listKotItems(pool, actor.outletId, kot.id);
    const hydrated = await hydrateKot(kot, items);
    emitKds({ type: 'kot.updated', kot: hydrated });
  }
  return item;
}

// ---- cancel order -----------------------------------------------------------

export async function cancelOrder(
  actor: AuthContext,
  orderId: string,
  input: CancelOrderInput,
  meta: AuditMeta = {},
): Promise<Order> {
  // Cancelling an order must also stop the kitchen from cooking anything
  // already dispatched. Void every active KOT on this order (new/in_progress/
  // ready), mark its items void, then flip the order itself to cancelled.
  const { order, voidedKotIds } = await withTransaction(async (tx) => {
    const before = await repo.findOrderById(tx, actor.outletId, orderId);
    if (!before) throw NotFound('order', orderId);
    if (before.status !== 'open') {
      throw new AppError({ statusCode: 409, code: ErrorCode.ORDER_NOT_OPEN, message: 'This order is not open' });
    }

    const kots = await repo.listKotsForOrder(tx, actor.outletId, orderId);
    const active = kots.filter(
      (k) => k.status === 'new' || k.status === 'in_progress' || k.status === 'ready',
    );
    const voidedIds: string[] = [];
    for (const k of active) {
      const voided = await repo.transitionKotStatus(
        tx,
        actor.outletId,
        k.id,
        'void',
        `order cancelled: ${input.reason}`,
      );
      if (voided) {
        await repo.voidItemsForKot(
          tx,
          actor.outletId,
          k.id,
          `order cancelled: ${input.reason}`,
          actor.userId,
        );
        voidedIds.push(k.id);
      }
    }

    const after = await repo.markOrderCancelled(tx, actor.outletId, orderId, input.reason);
    if (!after) throw Conflict('order could not be cancelled');

    await writeAudit(tx, {
      actor,
      entityType: 'order',
      entityId: orderId,
      action: 'delete',
      before,
      after: { ...after, voidedKotIds: voidedIds },
      ...meta,
    });
    return { order: after, voidedKotIds: voidedIds };
  });

  // Broadcast void for each affected KOT so the KDS removes them from the queue.
  for (const kotId of voidedKotIds) {
    const k = await repo.findKotById(pool, actor.outletId, kotId);
    if (!k) continue;
    const items = await repo.listKotItems(pool, actor.outletId, kotId);
    const hydrated = await hydrateKot(k, items);
    emitKds({ type: 'kot.updated', kot: hydrated });
  }

  return order;
}

// ---- kot listing for KDS ----------------------------------------------------

export async function listKots(
  actor: AuthContext,
  opts: { status?: KotStatus; active?: boolean } = {},
): Promise<KotWithItems[]> {
  const kots = await repo.listKots(pool, actor.outletId, opts);
  if (kots.length === 0) return [];

  // Batch-fetch items for all kots and the order headers, then zip.
  const orderIds = [...new Set(kots.map((k) => k.orderId))];
  const headers = await repo.loadOrderHeadersForKots(pool, actor.outletId, orderIds);

  const out: KotWithItems[] = [];
  for (const k of kots) {
    const items = await repo.listKotItems(pool, actor.outletId, k.id);
    const h = headers.get(k.orderId);
    out.push({
      ...k,
      items,
      order: {
        id: k.orderId,
        orderNumber: h?.orderNumber ?? 0,
        orderType: h?.orderType ?? 'dine_in',
        tableId: h?.tableId ?? null,
        tableCode: h?.tableCode ?? null,
      },
    });
  }
  return out;
}

/**
 * Fetch a single KOT, fully hydrated with its items and a denormalised
 * parent-order header (table, order number, order type). Mirrors the shape
 * broadcast over /ws/kds. Used by the PDF reprint path and anywhere else
 * that needs a read-only view of one KOT.
 */
export async function getKotDetail(
  actor: AuthContext,
  kotId: string,
): Promise<KotWithItems> {
  const kot = await repo.findKotById(pool, actor.outletId, kotId);
  if (!kot) throw NotFound('kot', kotId);
  const items = await repo.listKotItems(pool, actor.outletId, kotId);
  return hydrateKot(kot, items);
}

// ---- helpers ----------------------------------------------------------------

async function hydrateKot(kot: Kot, items: OrderItem[]): Promise<KotWithItems> {
  const headers = await repo.loadOrderHeadersForKots(pool, kot.outletId, [kot.orderId]);
  const h = headers.get(kot.orderId);
  return {
    ...kot,
    items,
    order: {
      id: kot.orderId,
      orderNumber: h?.orderNumber ?? 0,
      orderType: h?.orderType ?? 'dine_in',
      tableId: h?.tableId ?? null,
      tableCode: h?.tableCode ?? null,
    },
  };
}

function emitKds(event: KdsEvent): void {
  // Fire-and-forget — broadcast failures must never break the HTTP response.
  try {
    broadcastKds(event);
  } catch {
    // ws layer logs its own errors.
  }
}
