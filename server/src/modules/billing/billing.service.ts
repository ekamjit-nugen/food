import { pool, withTransaction, type Queryable } from '../../db/index.js';
import type { AuthContext } from '../../middleware/auth.js';
import { writeAudit } from '../../middleware/audit.js';
import { AppError, BadRequest, Conflict, ErrorCode, NotFound } from '../../utils/errors.js';
import * as repo from './billing.repository.js';
import * as orderRepo from '../orders/orders.repository.js';
import {
  computeBill,
  type EngineDiscount,
  type EngineLineInput,
} from './billing.engine.js';
import type {
  GenerateBillInput,
  GenerateSplitBillsInput,
  LineDiscountEntryInput,
  RecordPaymentInput,
  RefundBillInput,
  SplitBillEntryInput,
  UpdateDiscountInput,
  VoidBillInput,
  VoidPaymentInput,
} from './billing.schemas.js';
import type { Bill, BillDetail, BillItem, DiscountType, Payment } from './billing.types.js';
import type { OrderItem } from '../orders/orders.types.js';

interface AuditMeta {
  requestId?: string;
  ipAddress?: string;
}

// ---- generation -------------------------------------------------------------

/**
 * Generate a bill for an order. The bill can only be generated if:
 *   - the order exists and is currently 'open'
 *   - every item is either committed to a KOT or void (no drafts left)
 *   - no bill already exists for this order
 *
 * The bill total is locked into the database. Applying/removing a discount
 * later via PATCH /bills/:id/discount will recompute and overwrite the
 * aggregate columns (while the bill is still open).
 */
export async function generateBillForOrder(
  actor: AuthContext,
  orderId: string,
  input: GenerateBillInput,
  meta: AuditMeta = {},
): Promise<BillDetail> {
  return withTransaction(async (tx) => {
    const order = await orderRepo.findOrderById(tx, actor.outletId, orderId);
    if (!order) throw NotFound('order', orderId);
    if (order.status !== 'open') {
      throw Conflict(`cannot bill a ${order.status} order`);
    }

    const existing = await repo.findBillsByOrderId(tx, actor.outletId, orderId);
    if (existing.length > 0) {
      // Covers both the non-split re-generate case and the "you already split
      // this order, can't fall back to a single bill" case.
      throw new AppError({
        statusCode: 409,
        code: ErrorCode.BILL_EXISTS,
        message: 'A bill already exists for this order',
        details: { billIds: existing.map((b) => b.id) },
      });
    }

    const items = await orderRepo.listOrderItems(tx, actor.outletId, orderId);
    const billable = items.filter((i) => !i.isVoid);
    if (billable.length === 0) {
      throw BadRequest('order has no billable items');
    }
    const drafts = items.filter((i) => !i.isVoid && i.kotId === null);
    if (drafts.length > 0) {
      throw new AppError({ statusCode: 409, code: ErrorCode.DRAFT_ITEMS_EXIST, message: 'Send all items to kitchen before generating a bill' });
    }

    const lineDiscountMap = validateLineDiscounts(
      input.lineDiscounts ?? [],
      billable,
    );
    const engineLines = toEngineLines(billable, lineDiscountMap);
    const engineDiscount = toEngineDiscount(input.discount ?? null);
    const computed = computeBill(engineLines, engineDiscount);

    const bill = await repo.insertBill(tx, {
      outletId: actor.outletId,
      orderId,
      subtotalPaise: computed.subtotalPaise,
      discountType: input.discount?.type ?? null,
      discountValue: toDiscountValue(input.discount),
      discountPaise: computed.discountPaise,
      discountReason: input.discount?.reason ?? null,
      lineDiscountTotalPaise: computed.lineDiscountTotalPaise,
      taxablePaise: computed.taxablePaise,
      cgstPaise: computed.cgstPaise,
      sgstPaise: computed.sgstPaise,
      totalTaxPaise: computed.totalTaxPaise,
      roundOffPaise: computed.roundOffPaise,
      totalPaise: computed.totalPaise,
      generatedBy: actor.userId,
    });

    const persistedItems: BillItem[] = [];
    for (const l of computed.lines) {
      const ld = lineDiscountMap.get(l.orderItemId) ?? null;
      persistedItems.push(
        await repo.insertBillItem(tx, {
          outletId: actor.outletId,
          billId: bill.id,
          orderItemId: l.orderItemId,
          menuItemName: l.menuItemName,
          variationName: l.variationName,
          quantity: l.quantity,
          unitPricePaise: l.unitPricePaise,
          addonsPaise: l.addonsPaise,
          lineSubtotalPaise: l.lineSubtotalPaise,
          lineDiscountType: ld?.type ?? null,
          lineDiscountValue: toDiscountValueRaw(ld),
          lineDiscountPaise: l.lineDiscountPaise,
          lineDiscountReason: ld?.reason ?? null,
          taxRateBps: l.taxRateBps,
          cgstPaise: l.cgstPaise,
          sgstPaise: l.sgstPaise,
          lineTotalPaise: l.lineTotalPaise,
        }),
      );
    }

    await writeAudit(tx, {
      actor,
      entityType: 'bill',
      entityId: bill.id,
      action: 'create',
      after: { ...bill, items: persistedItems },
      ...meta,
    });

    return { ...bill, items: persistedItems, payments: [] };
  });
}

// ---- split generation -------------------------------------------------------

/**
 * Generate multiple bills for one order in a single atomic transaction.
 *
 * Each split is a first-class bill — same schema, same downstream routes
 * (discount, payment, void, refund). The split flow just lets the caller
 * carve the order's non-void items into disjoint groups up front.
 *
 * Validation rules (all enforced before any INSERT):
 *   - order is open and has no bills yet (no re-splitting, no mixing with
 *     an already-generated single bill)
 *   - no draft items remain on the order
 *   - every orderItemId referenced exists on THIS order and is non-void
 *   - an orderItemId appears in at most one split
 *   - every non-void item on the order is covered by exactly one split
 *     (a split that leaves items unbilled would silently lose revenue)
 *   - each split contains at least one item (schema-enforced min 1)
 *
 * On success returns every created bill, fully hydrated, in the order the
 * splits were supplied.
 */
export async function generateSplitBillsForOrder(
  actor: AuthContext,
  orderId: string,
  input: GenerateSplitBillsInput,
  meta: AuditMeta = {},
): Promise<BillDetail[]> {
  return withTransaction(async (tx) => {
    const order = await orderRepo.findOrderById(tx, actor.outletId, orderId);
    if (!order) throw NotFound('order', orderId);
    if (order.status !== 'open') {
      throw Conflict(`cannot bill a ${order.status} order`);
    }

    const existing = await repo.findBillsByOrderId(tx, actor.outletId, orderId);
    if (existing.length > 0) {
      throw new AppError({
        statusCode: 409,
        code: ErrorCode.BILL_EXISTS,
        message: 'A bill already exists for this order',
        details: { billIds: existing.map((b) => b.id) },
      });
    }

    const items = await orderRepo.listOrderItems(tx, actor.outletId, orderId);
    const billable = items.filter((i) => !i.isVoid);
    if (billable.length === 0) {
      throw BadRequest('order has no billable items');
    }
    const drafts = items.filter((i) => !i.isVoid && i.kotId === null);
    if (drafts.length > 0) {
      throw new AppError({ statusCode: 409, code: ErrorCode.DRAFT_ITEMS_EXIST, message: 'Send all items to kitchen before generating a bill' });
    }

    validateSplits(input.splits, billable);

    const billableById = new Map(billable.map((i) => [i.id, i]));
    const persisted: BillDetail[] = [];

    for (const split of input.splits) {
      const splitItems = split.orderItemIds.map((id) => billableById.get(id)!);
      const lineDiscountMap = validateLineDiscounts(split.lineDiscounts, splitItems);
      const engineLines = toEngineLines(splitItems, lineDiscountMap);
      const engineDiscount = toEngineDiscount(split.discount);
      const computed = computeBill(engineLines, engineDiscount);

      const bill = await repo.insertBill(tx, {
        outletId: actor.outletId,
        orderId,
        subtotalPaise: computed.subtotalPaise,
        discountType: split.discount?.type ?? null,
        discountValue: toDiscountValue(split.discount),
        discountPaise: computed.discountPaise,
        discountReason: split.discount?.reason ?? null,
        lineDiscountTotalPaise: computed.lineDiscountTotalPaise,
        taxablePaise: computed.taxablePaise,
        cgstPaise: computed.cgstPaise,
        sgstPaise: computed.sgstPaise,
        totalTaxPaise: computed.totalTaxPaise,
        roundOffPaise: computed.roundOffPaise,
        totalPaise: computed.totalPaise,
        generatedBy: actor.userId,
      });

      const persistedItems: BillItem[] = [];
      for (const l of computed.lines) {
        const ld = lineDiscountMap.get(l.orderItemId) ?? null;
        persistedItems.push(
          await repo.insertBillItem(tx, {
            outletId: actor.outletId,
            billId: bill.id,
            orderItemId: l.orderItemId,
            menuItemName: l.menuItemName,
            variationName: l.variationName,
            quantity: l.quantity,
            unitPricePaise: l.unitPricePaise,
            addonsPaise: l.addonsPaise,
            lineSubtotalPaise: l.lineSubtotalPaise,
            lineDiscountType: ld?.type ?? null,
            lineDiscountValue: toDiscountValueRaw(ld),
            lineDiscountPaise: l.lineDiscountPaise,
            lineDiscountReason: ld?.reason ?? null,
            taxRateBps: l.taxRateBps,
            cgstPaise: l.cgstPaise,
            sgstPaise: l.sgstPaise,
            lineTotalPaise: l.lineTotalPaise,
          }),
        );
      }

      await writeAudit(tx, {
        actor,
        entityType: 'bill',
        entityId: bill.id,
        action: 'create',
        after: { ...bill, items: persistedItems, splitOfOrderId: orderId },
        ...meta,
      });

      persisted.push({ ...bill, items: persistedItems, payments: [] });
    }

    return persisted;
  });
}

// ---- discount update --------------------------------------------------------

export async function updateBillDiscount(
  actor: AuthContext,
  billId: string,
  input: UpdateDiscountInput,
  meta: AuditMeta = {},
): Promise<BillDetail> {
  return withTransaction(async (tx) => {
    const before = await repo.findBillById(tx, actor.outletId, billId);
    if (!before) throw NotFound('bill', billId);
    if (before.status !== 'open') {
      throw Conflict(`cannot change discount on a ${before.status} bill`);
    }

    // Re-source lines from order_items so the recompute uses the same
    // snapshot the bill was built on. (The order items are immutable except
    // for voiding, which billed items can't be anymore.)
    const items = await orderRepo.listOrderItems(tx, actor.outletId, before.orderId);
    const billable = items.filter((i) => !i.isVoid);

    // If the client omitted `lineDiscounts`, preserve whatever's currently on
    // the bill. If they passed an array (even empty), replace the full set —
    // empty array = clear all line discounts.
    const lineDiscountMap: Map<string, LineDiscountEntryInput['discount']> =
      input.lineDiscounts === undefined
        ? await readExistingLineDiscounts(tx, actor.outletId, billId)
        : validateLineDiscounts(input.lineDiscounts, billable);

    const engineLines = toEngineLines(billable, lineDiscountMap);
    const engineDiscount = toEngineDiscount(input.discount);
    const computed = computeBill(engineLines, engineDiscount);

    const updated = await repo.updateBillTotals(tx, actor.outletId, billId, {
      discountType: input.discount?.type ?? null,
      discountValue: toDiscountValue(input.discount),
      discountPaise: computed.discountPaise,
      discountReason: input.discount?.reason ?? null,
      lineDiscountTotalPaise: computed.lineDiscountTotalPaise,
      taxablePaise: computed.taxablePaise,
      cgstPaise: computed.cgstPaise,
      sgstPaise: computed.sgstPaise,
      totalTaxPaise: computed.totalTaxPaise,
      roundOffPaise: computed.roundOffPaise,
      totalPaise: computed.totalPaise,
    });
    if (!updated) throw Conflict('bill could not be updated');

    // Rewrite line items so per-line totals reflect the new discount prorata.
    await repo.deleteBillItems(tx, actor.outletId, billId);
    const persistedItems: BillItem[] = [];
    for (const l of computed.lines) {
      const ld = lineDiscountMap.get(l.orderItemId) ?? null;
      persistedItems.push(
        await repo.insertBillItem(tx, {
          outletId: actor.outletId,
          billId,
          orderItemId: l.orderItemId,
          menuItemName: l.menuItemName,
          variationName: l.variationName,
          quantity: l.quantity,
          unitPricePaise: l.unitPricePaise,
          addonsPaise: l.addonsPaise,
          lineSubtotalPaise: l.lineSubtotalPaise,
          lineDiscountType: ld?.type ?? null,
          lineDiscountValue: toDiscountValueRaw(ld),
          lineDiscountPaise: l.lineDiscountPaise,
          lineDiscountReason: ld?.reason ?? null,
          taxRateBps: l.taxRateBps,
          cgstPaise: l.cgstPaise,
          sgstPaise: l.sgstPaise,
          lineTotalPaise: l.lineTotalPaise,
        }),
      );
    }

    await writeAudit(tx, {
      actor,
      entityType: 'bill',
      entityId: billId,
      action: 'update',
      before,
      after: updated,
      ...meta,
    });

    const payments = await repo.listPayments(tx, actor.outletId, billId);
    return { ...updated, items: persistedItems, payments };
  });
}

// ---- payments ---------------------------------------------------------------

/**
 * Record a single payment against a bill. Payments are additive — a bill
 * can be settled across cash + UPI. When the running `paid_paise` reaches
 * the bill total we flip the bill to 'paid' and close the parent order in
 * the same transaction.
 *
 * Overpayment (paid_paise > total_paise) is rejected in v1. If the guest
 * wants to pay more and leave a tip, record the exact total here and
 * handle tips outside the bill ledger.
 */
export async function recordPayment(
  actor: AuthContext,
  billId: string,
  input: RecordPaymentInput,
  meta: AuditMeta = {},
): Promise<{ bill: Bill; payment: Payment }> {
  // ── Idempotency short-circuit ──────────────────────────────────────────
  // If a payment with this key already exists (network retry / double-tap),
  // return it immediately without touching the bill ledger again.
  const existing = await repo.findPaymentByIdempotencyKey(
    pool,
    actor.outletId,
    input.idempotencyKey,
  );
  if (existing) {
    const bill = await repo.findBillById(
      pool,
      actor.outletId,
      billId,
    );
    if (!bill) throw NotFound('bill', billId);
    return { bill, payment: existing };
  }

  return withTransaction(async (tx) => {
    const bill = await repo.findBillById(tx, actor.outletId, billId);
    if (!bill) throw NotFound('bill', billId);
    if (bill.status !== 'open') {
      throw Conflict(`cannot record payment on a ${bill.status} bill`);
    }
    const remaining = bill.totalPaise - bill.paidPaise;
    if (input.amountPaise > remaining) {
      throw BadRequest(`payment exceeds outstanding balance of ${remaining} paise`);
    }

    const payment = await repo.insertPayment(tx, {
      outletId: actor.outletId,
      billId,
      method: input.method,
      amountPaise: input.amountPaise,
      reference: input.reference ?? null,
      note: input.note ?? null,
      receivedBy: actor.userId,
      idempotencyKey: input.idempotencyKey,
    });

    let updatedBill = await repo.incrementBillPaid(
      tx,
      actor.outletId,
      billId,
      input.amountPaise,
    );
    if (!updatedBill) throw Conflict('bill could not be updated');

    if (updatedBill.paidPaise >= updatedBill.totalPaise) {
      const paid = await repo.markBillPaid(
        tx,
        actor.outletId,
        billId,
        updatedBill.paidPaise,
      );
      if (!paid) throw Conflict('bill could not be closed');
      updatedBill = paid;
      // Sibling-aware order closure: with split bills, an order may carry
      // multiple bills. Only close the order when every bill on it is in a
      // terminal state (paid or void) AND at least one is paid. A single
      // non-split bill is just the N=1 case of this rule.
      await maybeCloseOrder(tx, actor.outletId, updatedBill.orderId);
    }

    await writeAudit(tx, {
      actor,
      entityType: 'payment',
      entityId: payment.id,
      action: 'create',
      after: {
        paymentId: payment.id,
        billId,
        method: payment.method,
        amountPaise: payment.amountPaise,
        idempotencyKey: input.idempotencyKey,
        billStatusAfter: updatedBill.status,
      },
      ...meta,
    });

    return { bill: updatedBill, payment };
  });
}

// ---- void bill --------------------------------------------------------------

export async function voidBill(
  actor: AuthContext,
  billId: string,
  input: VoidBillInput,
  meta: AuditMeta = {},
): Promise<Bill> {
  return withTransaction(async (tx) => {
    const before = await repo.findBillById(tx, actor.outletId, billId);
    if (!before) throw NotFound('bill', billId);
    if (before.status !== 'open') {
      throw Conflict(`cannot void a ${before.status} bill`);
    }

    // If the bill has partial payments, void them all first so the bill
    // can be cleanly voided. This removes the v1 limitation where a bill
    // with any payment was stuck in limbo.
    let voidedPaymentCount = 0;
    let voidedPaymentTotalPaise = 0;
    if (before.paidPaise > 0) {
      const voidedPayments = await repo.voidAllPaymentsForBill(
        tx, actor.outletId, billId, input.reason, actor.userId,
      );
      voidedPaymentCount = voidedPayments.length;
      voidedPaymentTotalPaise = voidedPayments.reduce((sum, p) => sum + p.amountPaise, 0);
      await repo.decrementBillPaid(tx, actor.outletId, billId, voidedPaymentTotalPaise);
    }

    const voided = await repo.voidBill(
      tx,
      actor.outletId,
      billId,
      input.reason,
      actor.userId,
    );
    if (!voided) throw Conflict('bill could not be voided');

    await writeAudit(tx, {
      actor,
      entityType: 'bill',
      entityId: billId,
      action: 'delete',
      before,
      after: {
        ...voided,
        voidedPaymentCount,
        voidedPaymentTotalPaise: Number(voidedPaymentTotalPaise),
      },
      ...meta,
    });

    return voided;
  });
}

// ---- void a single payment (correction) ------------------------------------

/**
 * Void a single payment. Used to correct a mis-recorded payment (wrong
 * method, wrong amount, wrong customer). This is NOT a refund — see
 * refundBill for that.
 *
 * Transactional flow:
 *   1. Find the payment. Reject if missing or already voided.
 *   2. Reject if its parent bill is already 'void' (refunded). A voided
 *      bill's payments are immutable; that's part of what void means.
 *   3. Mark the payment void with reason + actor.
 *   4. Decrement bill.paid_paise by the voided amount.
 *   5. If the bill was 'paid' and paid_paise is now < total_paise, flip
 *      the bill back to 'open' and re-open the parent order (the closing
 *      transition was caused by this payment; undoing it undoes the close).
 *   6. Audit.
 *
 * End state: the bill is in whatever state is consistent with the remaining
 * payments. Staff can now record a corrected payment, or leave it open for
 * the guest to settle again.
 */
export async function voidPayment(
  actor: AuthContext,
  billId: string,
  paymentId: string,
  input: VoidPaymentInput,
  meta: AuditMeta = {},
): Promise<{ bill: Bill; payment: Payment }> {
  return withTransaction(async (tx) => {
    const bill = await repo.findBillById(tx, actor.outletId, billId);
    if (!bill) throw NotFound('bill', billId);
    if (bill.status === 'void') {
      throw Conflict('cannot void a payment on a void bill');
    }

    const payment = await repo.findPaymentById(tx, actor.outletId, paymentId);
    if (!payment) throw NotFound('payment', paymentId);
    if (payment.billId !== billId) {
      // Guard against cross-bill URL tampering.
      throw NotFound('payment', paymentId);
    }
    if (payment.isVoid) {
      throw Conflict('payment is already voided');
    }

    const voidedPayment = await repo.voidPayment(
      tx,
      actor.outletId,
      paymentId,
      input.reason,
      actor.userId,
    );
    if (!voidedPayment) throw Conflict('payment could not be voided');

    let updatedBill = await repo.decrementBillPaid(
      tx,
      actor.outletId,
      billId,
      payment.amountPaise,
    );
    if (!updatedBill) {
      // Should be impossible — paid_paise must be >= this payment's amount.
      throw Conflict('bill paid balance is inconsistent');
    }

    // If voiding dropped the bill below its total, it can no longer be 'paid'.
    // Reopen the bill and the parent order so staff can take corrective action.
    if (bill.status === 'paid' && updatedBill.paidPaise < updatedBill.totalPaise) {
      const reopened = await repo.reopenBill(tx, actor.outletId, billId);
      if (!reopened) throw Conflict('bill could not be reopened');
      updatedBill = reopened;
      await tx.query(
        `UPDATE orders
            SET status = 'open', closed_at = NULL
          WHERE outlet_id = $1 AND id = $2 AND status = 'closed'`,
        [actor.outletId, updatedBill.orderId],
      );
    }

    await writeAudit(tx, {
      actor,
      entityType: 'payment',
      entityId: paymentId,
      action: 'delete',
      before: payment,
      after: voidedPayment,
      ...meta,
    });

    return { bill: updatedBill, payment: voidedPayment };
  });
}

// ---- refund a paid bill -----------------------------------------------------

/**
 * Refund a paid bill. Different from voidBill (which only handles unpaid
 * bills) and from voidPayment (which is a single-row correction).
 *
 * Transactional flow:
 *   1. Find the bill. Must be 'paid' — refunding an open bill means
 *      "void it", use voidBill instead; refunding a void bill is a no-op.
 *   2. Void every non-void payment on the bill in one UPDATE.
 *   3. Force the bill to 'void' (forceVoidBill skips the open-only guard
 *      that voidBill enforces).
 *   4. Cancel the parent order. End state is cancelled, not re-open — the
 *      guest has already left and the table needs to be freed without
 *      implying the meal is still in-flight.
 *   5. Audit.
 *
 * Once refunded, the bill cannot be un-refunded. Record a fresh order if
 * you need to re-charge the guest.
 */
export async function refundBill(
  actor: AuthContext,
  billId: string,
  input: RefundBillInput,
  meta: AuditMeta = {},
): Promise<Bill> {
  return withTransaction(async (tx) => {
    const before = await repo.findBillById(tx, actor.outletId, billId);
    if (!before) throw NotFound('bill', billId);
    if (before.status === 'void') {
      throw Conflict('bill is already voided');
    }
    if (before.status !== 'paid') {
      throw Conflict(
        `refund only applies to paid bills; use /void for an ${before.status} bill`,
      );
    }

    const voidedPayments = await repo.voidAllPaymentsForBill(
      tx,
      actor.outletId,
      billId,
      input.reason,
      actor.userId,
    );

    const voided = await repo.forceVoidBill(
      tx,
      actor.outletId,
      billId,
      input.reason,
      actor.userId,
    );
    if (!voided) throw Conflict('bill could not be refunded');

    // Cancel the parent order only if every bill on it is now void. In a
    // split, refunding one sub-bill leaves the others (paid or still open)
    // valid — the table/ticket is NOT cancelled. If the last surviving
    // bill has just been refunded, the whole order is effectively cancelled.
    const siblings = await repo.findBillsByOrderId(tx, actor.outletId, before.orderId);
    const allVoid = siblings.every((b) => b.status === 'void');
    if (allVoid) {
      await tx.query(
        `UPDATE orders
            SET status = 'cancelled',
                cancelled_at = NOW(),
                cancelled_reason = $3
          WHERE outlet_id = $1 AND id = $2 AND status <> 'cancelled'`,
        [actor.outletId, before.orderId, `refund: ${input.reason}`],
      );
    } else {
      // Order may have been closed (all bills settled). If other bills are
      // still paid, keeping it closed is correct. If this refund left at
      // least one bill open, the order needs to reopen so staff can still
      // collect payment on the unsettled siblings.
      const anyOpen = siblings.some((b) => b.status === 'open');
      if (anyOpen) {
        await tx.query(
          `UPDATE orders
              SET status = 'open', closed_at = NULL
            WHERE outlet_id = $1 AND id = $2 AND status = 'closed'`,
          [actor.outletId, before.orderId],
        );
      }
    }

    await writeAudit(tx, {
      actor,
      entityType: 'bill',
      entityId: billId,
      action: 'delete',
      before,
      after: {
        ...voided,
        voidedPaymentIds: voidedPayments.map((p) => p.id),
      },
      ...meta,
    });

    return voided;
  });
}

// ---- reads ------------------------------------------------------------------

export async function getBillDetail(
  actor: AuthContext,
  billId: string,
): Promise<BillDetail> {
  const bill = await repo.findBillById(pool, actor.outletId, billId);
  if (!bill) throw NotFound('bill', billId);
  const [items, payments] = await Promise.all([
    repo.listBillItems(pool, actor.outletId, billId),
    repo.listPayments(pool, actor.outletId, billId),
  ]);
  return { ...bill, items, payments };
}

/**
 * Singular bill-for-order endpoint. Returns the one bill when the order has
 * exactly one, 404 when there are none, and 409 when the order has been
 * split — the caller must use listBillsForOrder in that case.
 */
export async function getBillForOrder(
  actor: AuthContext,
  orderId: string,
): Promise<BillDetail> {
  const bills = await repo.findBillsByOrderId(pool, actor.outletId, orderId);
  if (bills.length === 0) throw NotFound('bill for order', orderId);
  if (bills.length > 1) {
    throw Conflict('order has multiple bills (split); use GET /orders/:id/bills', {
      billIds: bills.map((b) => b.id),
    });
  }
  return getBillDetail(actor, bills[0]!.id);
}

/** Plural form — list every bill on an order, each fully hydrated. */
export async function listBillsForOrder(
  actor: AuthContext,
  orderId: string,
): Promise<BillDetail[]> {
  const bills = await repo.findBillsByOrderId(pool, actor.outletId, orderId);
  return Promise.all(bills.map((b) => getBillDetail(actor, b.id)));
}

export async function listBills(
  actor: AuthContext,
  opts: { status?: 'open' | 'paid' | 'void'; from?: Date; to?: Date } = {},
): Promise<Bill[]> {
  return repo.listBills(pool, actor.outletId, opts);
}

// ---- helpers ----------------------------------------------------------------

type LineDiscountSpec = LineDiscountEntryInput['discount'];
type LineDiscountMap = Map<string, LineDiscountSpec>;

function toEngineLines(
  items: OrderItem[],
  lineDiscounts: LineDiscountMap = new Map(),
): EngineLineInput[] {
  return items.map((i) => ({
    orderItemId: i.id,
    menuItemName: i.menuItemName,
    variationName: i.variationName,
    quantity: i.quantity,
    unitPricePaise: i.unitPricePaise,
    addonsPerUnitPaise: i.addons.reduce((a, ad) => a + ad.pricePaise, 0),
    taxRateBps: i.taxRateBps,
    discount: toEngineDiscount(lineDiscounts.get(i.id) ?? null),
  }));
}

function toEngineDiscount(d: LineDiscountSpec | UpdateDiscountInput['discount']): EngineDiscount {
  if (!d) return null;
  if (d.type === 'flat') {
    return { type: 'flat', valuePaise: d.valuePaise, reason: d.reason };
  }
  return { type: 'percent', valueBps: d.valueBps, reason: d.reason };
}

function toDiscountValue(d: UpdateDiscountInput['discount']): number | null {
  if (!d) return null;
  return d.type === 'flat' ? d.valuePaise : d.valueBps;
}

function toDiscountValueRaw(d: LineDiscountSpec | null): number | null {
  if (!d) return null;
  return d.type === 'flat' ? d.valuePaise : d.valueBps;
}

/**
 * Validate a split-bills payload against the billable order items. Throws
 * BadRequest on any violation; returns nothing on success. All checks are
 * pure — no DB access.
 */
function validateSplits(
  splits: SplitBillEntryInput[],
  billable: OrderItem[],
): void {
  const billableIds = new Set(billable.map((i) => i.id));
  const seen = new Set<string>();
  for (let s = 0; s < splits.length; s++) {
    const split = splits[s]!;
    for (const id of split.orderItemIds) {
      if (!billableIds.has(id)) {
        throw BadRequest(
          `split ${s}: item ${id} is not a billable item on this order`,
        );
      }
      if (seen.has(id)) {
        throw BadRequest(`item ${id} appears in more than one split`);
      }
      seen.add(id);
    }
  }
  if (seen.size !== billableIds.size) {
    const missing = [...billableIds].filter((id) => !seen.has(id));
    throw BadRequest(
      `split would leave ${missing.length} item(s) unbilled: ${missing.join(', ')}`,
    );
  }
}

/**
 * Close the parent order iff every bill on it has reached a terminal state
 * (paid or void) AND at least one bill is paid. This is the sibling-aware
 * generalization of the single-bill closure rule: a split where one bill is
 * paid and another is still open leaves the order OPEN until every sibling
 * settles. A split where the last paid bill is refunded (all voids) does
 * NOT close the order — refundBill handles that case separately by
 * cancelling the order.
 *
 * Idempotent: the SQL UPDATE is gated on `status = 'open'` so calling this
 * multiple times is harmless.
 */
async function maybeCloseOrder(
  tx: Queryable,
  outletId: string,
  orderId: string,
): Promise<void> {
  const bills = await repo.findBillsByOrderId(tx, outletId, orderId);
  if (bills.length === 0) return;
  const allSettled = bills.every((b) => b.status === 'paid' || b.status === 'void');
  const anyPaid = bills.some((b) => b.status === 'paid');
  if (allSettled && anyPaid) {
    await tx.query(
      `UPDATE orders
          SET status = 'closed', closed_at = NOW()
        WHERE outlet_id = $1 AND id = $2 AND status = 'open'`,
      [outletId, orderId],
    );
  }
}

/**
 * Validate line-discount entries against the billable items and collapse
 * them into a map for fast lookup. Rejects:
 *   - orderItemIds not present in the billable set (or referring to a voided
 *     item) — 400, because the client is referencing something we won't bill.
 *   - duplicate orderItemIds — 400, because the caller's intent is ambiguous.
 * Entries with `discount: null` are preserved as explicit "no discount" but
 * have the same effect as being absent.
 */
function validateLineDiscounts(
  entries: LineDiscountEntryInput[],
  billable: OrderItem[],
): LineDiscountMap {
  const billableIds = new Set(billable.map((i) => i.id));
  const map: LineDiscountMap = new Map();
  for (const e of entries) {
    if (!billableIds.has(e.orderItemId)) {
      throw BadRequest(`line discount references unknown item ${e.orderItemId}`);
    }
    if (map.has(e.orderItemId)) {
      throw BadRequest(`duplicate line discount for item ${e.orderItemId}`);
    }
    map.set(e.orderItemId, e.discount);
  }
  return map;
}

/**
 * Re-materialize the existing line-discount map from bill_items. Used by
 * PATCH /bills/:id/discount when the caller omits `lineDiscounts` — the
 * intent there is "only touch the bill-level discount, leave lines alone".
 */
async function readExistingLineDiscounts(
  tx: Queryable,
  outletId: string,
  billId: string,
): Promise<LineDiscountMap> {
  const items = await repo.listBillItems(tx, outletId, billId);
  const map: LineDiscountMap = new Map();
  for (const bi of items) {
    if (bi.lineDiscountType === null) continue;
    if (bi.lineDiscountType === 'flat') {
      map.set(bi.orderItemId, {
        type: 'flat',
        valuePaise: bi.lineDiscountValue ?? 0,
        reason: bi.lineDiscountReason ?? '',
      });
    } else {
      map.set(bi.orderItemId, {
        type: 'percent',
        valueBps: bi.lineDiscountValue ?? 0,
        reason: bi.lineDiscountReason ?? '',
      });
    }
  }
  return map;
}

// Re-export types for controller usage.
export type { DiscountType };
