import type { Queryable } from '../../db/index.js';
import type {
  Bill,
  BillItem,
  BillStatus,
  DiscountType,
  Payment,
  PaymentMethod,
} from './billing.types.js';

// ---- row shapes -------------------------------------------------------------

interface BillRow {
  id: string;
  outlet_id: string;
  order_id: string;
  bill_number: string;
  subtotal_paise: string;
  discount_type: DiscountType | null;
  discount_value: string | null;
  discount_paise: string;
  discount_reason: string | null;
  line_discount_total_paise: string;
  taxable_paise: string;
  cgst_paise: string;
  sgst_paise: string;
  total_tax_paise: string;
  round_off_paise: string;
  total_paise: string;
  paid_paise: string;
  status: BillStatus;
  void_reason: string | null;
  voided_at: Date | null;
  voided_by: string | null;
  generated_by: string;
  generated_at: Date;
  paid_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface BillItemRow {
  id: string;
  outlet_id: string;
  bill_id: string;
  order_item_id: string;
  menu_item_name: string;
  variation_name: string | null;
  quantity: number;
  unit_price_paise: string;
  addons_paise: string;
  line_subtotal_paise: string;
  line_discount_type: DiscountType | null;
  line_discount_value: string | null;
  line_discount_paise: string;
  line_discount_reason: string | null;
  tax_rate_bps: number;
  cgst_paise: string;
  sgst_paise: string;
  line_total_paise: string;
  created_at: Date;
}

interface PaymentRow {
  id: string;
  outlet_id: string;
  bill_id: string;
  method: PaymentMethod;
  amount_paise: string;
  reference: string | null;
  note: string | null;
  received_by: string;
  received_at: Date;
  is_void: boolean;
  void_reason: string | null;
  voided_at: Date | null;
  voided_by: string | null;
  idempotency_key: string | null;
  created_at: Date;
}

function mapBill(row: BillRow): Bill {
  return {
    id: row.id,
    outletId: row.outlet_id,
    orderId: row.order_id,
    billNumber: Number(row.bill_number),
    subtotalPaise: Number(row.subtotal_paise),
    discountType: row.discount_type,
    discountValue: row.discount_value === null ? null : Number(row.discount_value),
    discountPaise: Number(row.discount_paise),
    discountReason: row.discount_reason,
    lineDiscountTotalPaise: Number(row.line_discount_total_paise),
    taxablePaise: Number(row.taxable_paise),
    cgstPaise: Number(row.cgst_paise),
    sgstPaise: Number(row.sgst_paise),
    totalTaxPaise: Number(row.total_tax_paise),
    roundOffPaise: Number(row.round_off_paise),
    totalPaise: Number(row.total_paise),
    paidPaise: Number(row.paid_paise),
    status: row.status,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by,
    generatedBy: row.generated_by,
    generatedAt: row.generated_at,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBillItem(row: BillItemRow): BillItem {
  return {
    id: row.id,
    outletId: row.outlet_id,
    billId: row.bill_id,
    orderItemId: row.order_item_id,
    menuItemName: row.menu_item_name,
    variationName: row.variation_name,
    quantity: row.quantity,
    unitPricePaise: Number(row.unit_price_paise),
    addonsPaise: Number(row.addons_paise),
    lineSubtotalPaise: Number(row.line_subtotal_paise),
    lineDiscountType: row.line_discount_type,
    lineDiscountValue:
      row.line_discount_value === null ? null : Number(row.line_discount_value),
    lineDiscountPaise: Number(row.line_discount_paise),
    lineDiscountReason: row.line_discount_reason,
    taxRateBps: row.tax_rate_bps,
    cgstPaise: Number(row.cgst_paise),
    sgstPaise: Number(row.sgst_paise),
    lineTotalPaise: Number(row.line_total_paise),
    createdAt: row.created_at,
  };
}

function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    outletId: row.outlet_id,
    billId: row.bill_id,
    method: row.method,
    amountPaise: Number(row.amount_paise),
    reference: row.reference,
    note: row.note,
    receivedBy: row.received_by,
    receivedAt: row.received_at,
    isVoid: row.is_void,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

// ---- bills ------------------------------------------------------------------

export interface InsertBillParams {
  outletId: string;
  orderId: string;
  subtotalPaise: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountPaise: number;
  discountReason: string | null;
  lineDiscountTotalPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalTaxPaise: number;
  roundOffPaise: number;
  totalPaise: number;
  generatedBy: string;
}

export async function insertBill(db: Queryable, p: InsertBillParams): Promise<Bill> {
  const { rows } = await db.query<BillRow>(
    `INSERT INTO bills
       (outlet_id, order_id, subtotal_paise,
        discount_type, discount_value, discount_paise, discount_reason,
        line_discount_total_paise,
        taxable_paise, cgst_paise, sgst_paise, total_tax_paise,
        round_off_paise, total_paise, generated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      p.outletId,
      p.orderId,
      p.subtotalPaise,
      p.discountType,
      p.discountValue,
      p.discountPaise,
      p.discountReason,
      p.lineDiscountTotalPaise,
      p.taxablePaise,
      p.cgstPaise,
      p.sgstPaise,
      p.totalTaxPaise,
      p.roundOffPaise,
      p.totalPaise,
      p.generatedBy,
    ],
  );
  return mapBill(rows[0]!);
}

export async function findBillById(
  db: Queryable,
  outletId: string,
  id: string,
): Promise<Bill | null> {
  const { rows } = await db.query<BillRow>(
    `SELECT * FROM bills WHERE outlet_id = $1 AND id = $2`,
    [outletId, id],
  );
  return rows[0] ? mapBill(rows[0]) : null;
}

/**
 * Return every bill on an order, newest first. Since splits landed, an order
 * can carry 0..N bills. Callers that want "is there any bill" should check
 * `.length > 0`; callers that want "the one bill" should handle the
 * multiple-result case explicitly.
 */
export async function findBillsByOrderId(
  db: Queryable,
  outletId: string,
  orderId: string,
): Promise<Bill[]> {
  const { rows } = await db.query<BillRow>(
    `SELECT * FROM bills
      WHERE outlet_id = $1 AND order_id = $2
      ORDER BY generated_at ASC, bill_number ASC`,
    [outletId, orderId],
  );
  return rows.map(mapBill);
}

export async function listBills(
  db: Queryable,
  outletId: string,
  opts: { status?: BillStatus; from?: Date; to?: Date } = {},
): Promise<Bill[]> {
  const conds = ['outlet_id = $1'];
  const values: unknown[] = [outletId];
  if (opts.status) {
    values.push(opts.status);
    conds.push(`status = $${values.length}`);
  }
  if (opts.from) {
    values.push(opts.from);
    conds.push(`generated_at >= $${values.length}`);
  }
  if (opts.to) {
    values.push(opts.to);
    conds.push(`generated_at < $${values.length}`);
  }
  const { rows } = await db.query<BillRow>(
    `SELECT * FROM bills WHERE ${conds.join(' AND ')}
     ORDER BY generated_at DESC`,
    values,
  );
  return rows.map(mapBill);
}

/**
 * Replace a bill's totals in-place. Used when a discount is applied, updated,
 * or cleared on an OPEN bill. The service layer recomputes via the engine
 * and calls this with a fresh snapshot.
 */
export interface UpdateBillTotalsParams {
  discountType: DiscountType | null;
  discountValue: number | null;
  discountPaise: number;
  discountReason: string | null;
  lineDiscountTotalPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalTaxPaise: number;
  roundOffPaise: number;
  totalPaise: number;
}

export async function updateBillTotals(
  db: Queryable,
  outletId: string,
  id: string,
  p: UpdateBillTotalsParams,
): Promise<Bill | null> {
  const { rows } = await db.query<BillRow>(
    `UPDATE bills
        SET discount_type = $3,
            discount_value = $4,
            discount_paise = $5,
            discount_reason = $6,
            line_discount_total_paise = $7,
            taxable_paise = $8,
            cgst_paise = $9,
            sgst_paise = $10,
            total_tax_paise = $11,
            round_off_paise = $12,
            total_paise = $13
      WHERE outlet_id = $1 AND id = $2 AND status = 'open'
      RETURNING *`,
    [
      outletId,
      id,
      p.discountType,
      p.discountValue,
      p.discountPaise,
      p.discountReason,
      p.lineDiscountTotalPaise,
      p.taxablePaise,
      p.cgstPaise,
      p.sgstPaise,
      p.totalTaxPaise,
      p.roundOffPaise,
      p.totalPaise,
    ],
  );
  return rows[0] ? mapBill(rows[0]) : null;
}

export async function markBillPaid(
  db: Queryable,
  outletId: string,
  id: string,
  paidPaise: number,
): Promise<Bill | null> {
  const { rows } = await db.query<BillRow>(
    `UPDATE bills
        SET status = 'paid', paid_paise = $3, paid_at = NOW()
      WHERE outlet_id = $1 AND id = $2 AND status = 'open'
      RETURNING *`,
    [outletId, id, paidPaise],
  );
  return rows[0] ? mapBill(rows[0]) : null;
}

export async function incrementBillPaid(
  db: Queryable,
  outletId: string,
  id: string,
  delta: number,
): Promise<Bill | null> {
  const { rows } = await db.query<BillRow>(
    `UPDATE bills
        SET paid_paise = paid_paise + $3
      WHERE outlet_id = $1 AND id = $2 AND status = 'open'
      RETURNING *`,
    [outletId, id, delta],
  );
  return rows[0] ? mapBill(rows[0]) : null;
}

export async function voidBill(
  db: Queryable,
  outletId: string,
  id: string,
  reason: string,
  voidedBy: string,
): Promise<Bill | null> {
  const { rows } = await db.query<BillRow>(
    `UPDATE bills
        SET status = 'void',
            void_reason = $3,
            voided_at = NOW(),
            voided_by = $4
      WHERE outlet_id = $1 AND id = $2 AND status = 'open'
      RETURNING *`,
    [outletId, id, reason, voidedBy],
  );
  return rows[0] ? mapBill(rows[0]) : null;
}

// ---- bill_items -------------------------------------------------------------

export interface InsertBillItemParams {
  outletId: string;
  billId: string;
  orderItemId: string;
  menuItemName: string;
  variationName: string | null;
  quantity: number;
  unitPricePaise: number;
  addonsPaise: number;
  lineSubtotalPaise: number;
  lineDiscountType: DiscountType | null;
  lineDiscountValue: number | null;
  lineDiscountPaise: number;
  lineDiscountReason: string | null;
  taxRateBps: number;
  cgstPaise: number;
  sgstPaise: number;
  lineTotalPaise: number;
}

export async function insertBillItem(
  db: Queryable,
  p: InsertBillItemParams,
): Promise<BillItem> {
  const { rows } = await db.query<BillItemRow>(
    `INSERT INTO bill_items
       (outlet_id, bill_id, order_item_id,
        menu_item_name, variation_name, quantity,
        unit_price_paise, addons_paise, line_subtotal_paise,
        line_discount_type, line_discount_value, line_discount_paise, line_discount_reason,
        tax_rate_bps, cgst_paise, sgst_paise, line_total_paise)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      p.outletId,
      p.billId,
      p.orderItemId,
      p.menuItemName,
      p.variationName,
      p.quantity,
      p.unitPricePaise,
      p.addonsPaise,
      p.lineSubtotalPaise,
      p.lineDiscountType,
      p.lineDiscountValue,
      p.lineDiscountPaise,
      p.lineDiscountReason,
      p.taxRateBps,
      p.cgstPaise,
      p.sgstPaise,
      p.lineTotalPaise,
    ],
  );
  return mapBillItem(rows[0]!);
}

export async function deleteBillItems(
  db: Queryable,
  outletId: string,
  billId: string,
): Promise<void> {
  await db.query(`DELETE FROM bill_items WHERE outlet_id = $1 AND bill_id = $2`, [
    outletId,
    billId,
  ]);
}

export async function listBillItems(
  db: Queryable,
  outletId: string,
  billId: string,
): Promise<BillItem[]> {
  const { rows } = await db.query<BillItemRow>(
    `SELECT * FROM bill_items
      WHERE outlet_id = $1 AND bill_id = $2
      ORDER BY created_at ASC`,
    [outletId, billId],
  );
  return rows.map(mapBillItem);
}

// ---- payments ---------------------------------------------------------------

export interface InsertPaymentParams {
  outletId: string;
  billId: string;
  method: PaymentMethod;
  amountPaise: number;
  reference: string | null;
  note: string | null;
  receivedBy: string;
  idempotencyKey: string;
}

export async function insertPayment(
  db: Queryable,
  p: InsertPaymentParams,
): Promise<Payment> {
  const { rows } = await db.query<PaymentRow>(
    `INSERT INTO payments
       (outlet_id, bill_id, method, amount_paise, reference, note, received_by, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      p.outletId,
      p.billId,
      p.method,
      p.amountPaise,
      p.reference,
      p.note,
      p.receivedBy,
      p.idempotencyKey,
    ],
  );
  return mapPayment(rows[0]!);
}

/**
 * Look up an existing non-void payment by its idempotency key. Returns null
 * if no matching payment exists. Used to short-circuit duplicate submissions.
 */
export async function findPaymentByIdempotencyKey(
  db: Queryable,
  outletId: string,
  idempotencyKey: string,
): Promise<Payment | null> {
  const { rows } = await db.query<PaymentRow>(
    `SELECT * FROM payments
      WHERE outlet_id = $1 AND idempotency_key = $2 AND is_void = FALSE
      LIMIT 1`,
    [outletId, idempotencyKey],
  );
  return rows[0] ? mapPayment(rows[0]) : null;
}

export async function listPayments(
  db: Queryable,
  outletId: string,
  billId: string,
): Promise<Payment[]> {
  // Deliberately includes voided payments so callers (e.g. bill detail UI)
  // can display the full audit trail with voided rows struck through.
  // Billing math must consult bills.paid_paise, NOT the sum of this list.
  const { rows } = await db.query<PaymentRow>(
    `SELECT * FROM payments
      WHERE outlet_id = $1 AND bill_id = $2
      ORDER BY received_at ASC`,
    [outletId, billId],
  );
  return rows.map(mapPayment);
}

export async function findPaymentById(
  db: Queryable,
  outletId: string,
  id: string,
): Promise<Payment | null> {
  const { rows } = await db.query<PaymentRow>(
    `SELECT * FROM payments WHERE outlet_id = $1 AND id = $2`,
    [outletId, id],
  );
  return rows[0] ? mapPayment(rows[0]) : null;
}

/**
 * Soft-delete a payment. Only transitions FROM is_void = FALSE so a double
 * void is a no-op (returns null) rather than silently rewriting void_reason.
 */
export async function voidPayment(
  db: Queryable,
  outletId: string,
  id: string,
  reason: string,
  voidedBy: string,
): Promise<Payment | null> {
  const { rows } = await db.query<PaymentRow>(
    `UPDATE payments
        SET is_void = TRUE,
            void_reason = $3,
            voided_at = NOW(),
            voided_by = $4
      WHERE outlet_id = $1 AND id = $2 AND is_void = FALSE
      RETURNING *`,
    [outletId, id, reason, voidedBy],
  );
  return rows[0] ? mapPayment(rows[0]) : null;
}

/**
 * Void every currently-active payment for a bill in one shot. Used by the
 * refund flow. Returns the voided rows so the service can audit each one.
 */
export async function voidAllPaymentsForBill(
  db: Queryable,
  outletId: string,
  billId: string,
  reason: string,
  voidedBy: string,
): Promise<Payment[]> {
  const { rows } = await db.query<PaymentRow>(
    `UPDATE payments
        SET is_void = TRUE,
            void_reason = $3,
            voided_at = NOW(),
            voided_by = $4
      WHERE outlet_id = $1 AND bill_id = $2 AND is_void = FALSE
      RETURNING *`,
    [outletId, billId, reason, voidedBy],
  );
  return rows.map(mapPayment);
}

/**
 * Decrement the cached paid_paise counter on a bill by the given amount.
 * Does NOT gate on bill status — the caller (void-payment service) may need
 * to decrement a 'paid' bill before flipping it back to 'open'. Refuses to
 * let paid_paise go negative.
 */
export async function decrementBillPaid(
  db: Queryable,
  outletId: string,
  id: string,
  delta: number,
): Promise<Bill | null> {
  const { rows } = await db.query<BillRow>(
    `UPDATE bills
        SET paid_paise = paid_paise - $3
      WHERE outlet_id = $1 AND id = $2 AND paid_paise >= $3
      RETURNING *`,
    [outletId, id, delta],
  );
  return rows[0] ? mapBill(rows[0]) : null;
}

/**
 * Revert a 'paid' bill back to 'open'. Called when voiding a payment drops
 * paid_paise below the bill total. Clears paid_at to match the new state.
 */
export async function reopenBill(
  db: Queryable,
  outletId: string,
  id: string,
): Promise<Bill | null> {
  const { rows } = await db.query<BillRow>(
    `UPDATE bills
        SET status = 'open', paid_at = NULL
      WHERE outlet_id = $1 AND id = $2 AND status = 'paid'
      RETURNING *`,
    [outletId, id],
  );
  return rows[0] ? mapBill(rows[0]) : null;
}

/**
 * Force a bill into 'void' state regardless of current status. Separate from
 * voidBill() (which only accepts 'open') because the refund flow needs to
 * void a currently-paid bill as part of a single atomic transaction.
 */
export async function forceVoidBill(
  db: Queryable,
  outletId: string,
  id: string,
  reason: string,
  voidedBy: string,
): Promise<Bill | null> {
  const { rows } = await db.query<BillRow>(
    `UPDATE bills
        SET status = 'void',
            void_reason = $3,
            voided_at = NOW(),
            voided_by = $4,
            paid_at = NULL
      WHERE outlet_id = $1 AND id = $2 AND status <> 'void'
      RETURNING *`,
    [outletId, id, reason, voidedBy],
  );
  return rows[0] ? mapBill(rows[0]) : null;
}
