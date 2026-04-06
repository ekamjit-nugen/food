import type { Queryable } from '../../db/index.js';

/**
 * Report repository — aggregation SQL only, no writes.
 *
 * Every report filters on `bills.status = 'paid'` and `bills.generated_at`
 * in range, EXCEPT the order master, which lists orders regardless of
 * billing state (a cancelled order is still interesting on the day's log).
 *
 * Date range semantics: `from` is inclusive, `to` is EXCLUSIVE — this is
 * the convention that makes "all of Jan 15" expressible as
 * [2026-01-15T00:00Z, 2026-01-16T00:00Z). The service layer defaults a
 * missing `to` to "now + 1ms" so the inclusive UX doesn't surprise anyone.
 */

export interface DailySalesRow {
  totalBills: number;
  totalRevenuePaise: number;
  totalTaxPaise: number;
  totalDiscountPaise: number;
  totalRoundOffPaise: number;
  byOrderType: Array<{
    orderType: 'dine_in' | 'takeaway';
    bills: number;
    revenuePaise: number;
  }>;
  byPaymentMethod: Array<{
    method: 'cash' | 'upi' | 'card' | 'other';
    payments: number;
    amountPaise: number;
  }>;
  // Per-outlet rollup. Always populated — single-outlet callers just get
  // one row, and tenant-wide callers get a row per outlet so the admin can
  // compare side by side. The UI decides whether to show this based on
  // whether length > 1.
  byOutlet: Array<{
    outletId: string;
    outletName: string;
    bills: number;
    revenuePaise: number;
  }>;
}

export async function dailySales(
  db: Queryable,
  outletIds: string[],
  from: Date,
  to: Date,
): Promise<DailySalesRow> {
  // Empty scope (no accessible outlets) should return an empty aggregate, not
  // blow up on `ANY($1::uuid[])` with a zero-length array. Short-circuit.
  if (outletIds.length === 0) {
    return {
      totalBills: 0,
      totalRevenuePaise: 0,
      totalTaxPaise: 0,
      totalDiscountPaise: 0,
      totalRoundOffPaise: 0,
      byOrderType: [],
      byPaymentMethod: [],
      byOutlet: [],
    };
  }

  const { rows: totals } = await db.query<{
    total_bills: string;
    total_revenue: string | null;
    total_tax: string | null;
    total_discount: string | null;
    total_round_off: string | null;
  }>(
    `SELECT COUNT(*)::bigint           AS total_bills,
            SUM(total_paise)           AS total_revenue,
            SUM(total_tax_paise)       AS total_tax,
            -- Combined discount = bill-level + sum of per-line discounts.
            -- Both columns are non-null-default-0, so SUM never returns NULL
            -- except when there are zero rows (which COALESCE here handles).
            SUM(discount_paise + line_discount_total_paise) AS total_discount,
            SUM(round_off_paise)       AS total_round_off
       FROM bills
      WHERE outlet_id = ANY($1::uuid[])
        AND status = 'paid'
        AND generated_at >= $2
        AND generated_at <  $3`,
    [outletIds, from, to],
  );

  const { rows: byType } = await db.query<{
    order_type: 'dine_in' | 'takeaway';
    bills: string;
    revenue: string;
  }>(
    `SELECT o.order_type, COUNT(b.id)::bigint AS bills, SUM(b.total_paise) AS revenue
       FROM bills b
       JOIN orders o ON o.id = b.order_id
      WHERE b.outlet_id = ANY($1::uuid[])
        AND b.status = 'paid'
        AND b.generated_at >= $2
        AND b.generated_at <  $3
      GROUP BY o.order_type
      ORDER BY o.order_type`,
    [outletIds, from, to],
  );

  const { rows: byMethod } = await db.query<{
    method: 'cash' | 'upi' | 'card' | 'other';
    payments: string;
    amount: string;
  }>(
    `SELECT p.method, COUNT(p.id)::bigint AS payments, SUM(p.amount_paise) AS amount
       FROM payments p
       JOIN bills b ON b.id = p.bill_id
      WHERE p.outlet_id = ANY($1::uuid[])
        AND p.is_void = FALSE
        AND b.status = 'paid'
        AND b.generated_at >= $2
        AND b.generated_at <  $3
      GROUP BY p.method
      ORDER BY amount DESC`,
    [outletIds, from, to],
  );

  // Per-outlet rollup. LEFT JOIN from outlets so an outlet with zero bills
  // in the range still shows up with a zero row — avoids "outlet vanished"
  // confusion in the UI when one outlet had a dead day.
  const { rows: byOutletRows } = await db.query<{
    outlet_id: string;
    outlet_name: string;
    bills: string;
    revenue: string | null;
  }>(
    `SELECT o.id AS outlet_id,
            o.name AS outlet_name,
            COUNT(b.id)::bigint AS bills,
            COALESCE(SUM(b.total_paise), 0) AS revenue
       FROM outlets o
       LEFT JOIN bills b
              ON b.outlet_id = o.id
             AND b.status = 'paid'
             AND b.generated_at >= $2
             AND b.generated_at <  $3
      WHERE o.id = ANY($1::uuid[])
      GROUP BY o.id, o.name
      ORDER BY revenue DESC NULLS LAST, o.name ASC`,
    [outletIds, from, to],
  );

  const t = totals[0]!;
  return {
    totalBills: Number(t.total_bills),
    totalRevenuePaise: Number(t.total_revenue ?? 0),
    totalTaxPaise: Number(t.total_tax ?? 0),
    totalDiscountPaise: Number(t.total_discount ?? 0),
    totalRoundOffPaise: Number(t.total_round_off ?? 0),
    byOrderType: byType.map((r) => ({
      orderType: r.order_type,
      bills: Number(r.bills),
      revenuePaise: Number(r.revenue),
    })),
    byPaymentMethod: byMethod.map((r) => ({
      method: r.method,
      payments: Number(r.payments),
      amountPaise: Number(r.amount),
    })),
    byOutlet: byOutletRows.map((r) => ({
      outletId: r.outlet_id,
      outletName: r.outlet_name,
      bills: Number(r.bills),
      revenuePaise: Number(r.revenue ?? 0),
    })),
  };
}

export interface ItemSalesRow {
  menuItemName: string;
  variationName: string | null;
  quantity: number;
  grossPaise: number;
  discountPaise: number;
  taxPaise: number;
  netPaise: number;
}

export async function itemWiseSales(
  db: Queryable,
  outletIds: string[],
  from: Date,
  to: Date,
): Promise<ItemSalesRow[]> {
  if (outletIds.length === 0) return [];
  const { rows } = await db.query<{
    menu_item_name: string;
    variation_name: string | null;
    quantity: string;
    gross: string;
    discount: string;
    tax: string;
    net: string;
  }>(
    `SELECT bi.menu_item_name,
            bi.variation_name,
            SUM(bi.quantity)::bigint                           AS quantity,
            SUM(bi.line_subtotal_paise)                        AS gross,
            SUM(bi.line_subtotal_paise - (bi.line_total_paise - bi.cgst_paise - bi.sgst_paise)) AS discount,
            SUM(bi.cgst_paise + bi.sgst_paise)                 AS tax,
            SUM(bi.line_total_paise)                           AS net
       FROM bill_items bi
       JOIN bills b ON b.id = bi.bill_id
      WHERE bi.outlet_id = ANY($1::uuid[])
        AND b.status = 'paid'
        AND b.generated_at >= $2
        AND b.generated_at <  $3
      GROUP BY bi.menu_item_name, bi.variation_name
      ORDER BY net DESC NULLS LAST`,
    [outletIds, from, to],
  );
  return rows.map((r) => ({
    menuItemName: r.menu_item_name,
    variationName: r.variation_name,
    quantity: Number(r.quantity),
    grossPaise: Number(r.gross),
    discountPaise: Number(r.discount),
    taxPaise: Number(r.tax),
    netPaise: Number(r.net),
  }));
}

export interface CategorySalesRow {
  categoryId: string | null;
  categoryName: string | null;
  quantity: number;
  netPaise: number;
}

export async function categoryWiseSales(
  db: Queryable,
  outletIds: string[],
  from: Date,
  to: Date,
): Promise<CategorySalesRow[]> {
  if (outletIds.length === 0) return [];
  // bill_items snapshots item name but not category. Join back through
  // order_items → menu_items → menu_categories. menu_items is soft-deleted,
  // so the category is still resolvable for any historical bill.
  const { rows } = await db.query<{
    category_id: string | null;
    category_name: string | null;
    quantity: string;
    net: string;
  }>(
    `SELECT mc.id   AS category_id,
            mc.name AS category_name,
            SUM(bi.quantity)::bigint AS quantity,
            SUM(bi.line_total_paise) AS net
       FROM bill_items bi
       JOIN bills b       ON b.id  = bi.bill_id
       LEFT JOIN order_items oi ON oi.id = bi.order_item_id
       LEFT JOIN menu_items  mi ON mi.id = oi.menu_item_id
       LEFT JOIN menu_categories mc ON mc.id = mi.category_id
      WHERE bi.outlet_id = ANY($1::uuid[])
        AND b.status = 'paid'
        AND b.generated_at >= $2
        AND b.generated_at <  $3
      GROUP BY mc.id, mc.name
      ORDER BY net DESC NULLS LAST`,
    [outletIds, from, to],
  );
  return rows.map((r) => ({
    categoryId: r.category_id,
    categoryName: r.category_name,
    quantity: Number(r.quantity),
    netPaise: Number(r.net),
  }));
}

export interface TaxSummaryRow {
  taxRateBps: number;
  taxableBasePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalTaxPaise: number;
}

export async function taxSummary(
  db: Queryable,
  outletIds: string[],
  from: Date,
  to: Date,
): Promise<TaxSummaryRow[]> {
  if (outletIds.length === 0) return [];
  // Taxable base is (line_total - cgst - sgst) — the already-discounted
  // amount tax was applied to. Grouping by tax_rate_bps lets the operator
  // see CGST/SGST split per slab.
  const { rows } = await db.query<{
    tax_rate_bps: number;
    base: string;
    cgst: string;
    sgst: string;
    total: string;
  }>(
    `SELECT bi.tax_rate_bps,
            SUM(bi.line_total_paise - bi.cgst_paise - bi.sgst_paise) AS base,
            SUM(bi.cgst_paise)                                        AS cgst,
            SUM(bi.sgst_paise)                                        AS sgst,
            SUM(bi.cgst_paise + bi.sgst_paise)                        AS total
       FROM bill_items bi
       JOIN bills b ON b.id = bi.bill_id
      WHERE bi.outlet_id = ANY($1::uuid[])
        AND b.status = 'paid'
        AND b.generated_at >= $2
        AND b.generated_at <  $3
      GROUP BY bi.tax_rate_bps
      ORDER BY bi.tax_rate_bps ASC`,
    [outletIds, from, to],
  );
  return rows.map((r) => ({
    taxRateBps: r.tax_rate_bps,
    taxableBasePaise: Number(r.base),
    cgstPaise: Number(r.cgst),
    sgstPaise: Number(r.sgst),
    totalTaxPaise: Number(r.total),
  }));
}

export interface OrderMasterRow {
  orderId: string;
  orderNumber: number;
  orderType: 'dine_in' | 'takeaway';
  status: 'open' | 'closed' | 'cancelled';
  outletId: string;
  outletName: string;
  tableCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  openedAt: Date;
  closedAt: Date | null;
  billId: string | null;
  billNumber: number | null;
  billStatus: 'open' | 'paid' | 'void' | null;
  subtotalPaise: number | null;
  discountPaise: number | null;
  taxPaise: number | null;
  totalPaise: number | null;
  openedByEmail: string | null;
}

export async function orderMaster(
  db: Queryable,
  outletIds: string[],
  opts: {
    from?: Date;
    to?: Date;
    status?: 'open' | 'closed' | 'cancelled';
    orderType?: 'dine_in' | 'takeaway';
  },
): Promise<OrderMasterRow[]> {
  if (outletIds.length === 0) return [];
  const conds = ['o.outlet_id = ANY($1::uuid[])'];
  const values: unknown[] = [outletIds];
  if (opts.from) {
    values.push(opts.from);
    conds.push(`o.opened_at >= $${values.length}`);
  }
  if (opts.to) {
    values.push(opts.to);
    conds.push(`o.opened_at <  $${values.length}`);
  }
  if (opts.status) {
    values.push(opts.status);
    conds.push(`o.status = $${values.length}`);
  }
  if (opts.orderType) {
    values.push(opts.orderType);
    conds.push(`o.order_type = $${values.length}`);
  }

  const { rows } = await db.query<{
    order_id: string;
    order_number: string;
    order_type: 'dine_in' | 'takeaway';
    status: 'open' | 'closed' | 'cancelled';
    outlet_id: string;
    outlet_name: string;
    table_code: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    opened_at: Date;
    closed_at: Date | null;
    bill_id: string | null;
    bill_number: string | null;
    bill_status: 'open' | 'paid' | 'void' | null;
    subtotal_paise: string | null;
    discount_paise: string | null;
    tax_paise: string | null;
    total_paise: string | null;
    opened_by_email: string | null;
  }>(
    `SELECT o.id                AS order_id,
            o.order_number,
            o.order_type,
            o.status,
            o.outlet_id,
            ol.name             AS outlet_name,
            t.code              AS table_code,
            o.customer_name,
            o.customer_phone,
            o.opened_at,
            o.closed_at,
            b.id                AS bill_id,
            b.bill_number,
            b.status            AS bill_status,
            b.subtotal_paise,
            b.discount_paise,
            b.total_tax_paise   AS tax_paise,
            b.total_paise,
            u.email             AS opened_by_email
       FROM orders o
       JOIN outlets ol ON ol.id = o.outlet_id
       LEFT JOIN dining_tables t ON t.id = o.table_id
       LEFT JOIN bills b ON b.order_id = o.id
       LEFT JOIN users u ON u.id = o.opened_by
      WHERE ${conds.join(' AND ')}
      ORDER BY o.opened_at DESC`,
    values,
  );

  return rows.map((r) => ({
    orderId: r.order_id,
    orderNumber: Number(r.order_number),
    orderType: r.order_type,
    status: r.status,
    outletId: r.outlet_id,
    outletName: r.outlet_name,
    tableCode: r.table_code,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    billId: r.bill_id,
    billNumber: r.bill_number === null ? null : Number(r.bill_number),
    billStatus: r.bill_status,
    subtotalPaise: r.subtotal_paise === null ? null : Number(r.subtotal_paise),
    discountPaise: r.discount_paise === null ? null : Number(r.discount_paise),
    taxPaise: r.tax_paise === null ? null : Number(r.tax_paise),
    totalPaise: r.total_paise === null ? null : Number(r.total_paise),
    openedByEmail: r.opened_by_email,
  }));
}
