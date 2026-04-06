import type { Queryable } from '../../db/index.js';

export interface OutletSettings {
  id: string;
  name: string;
  legalName: string | null;
  gstin: string | null;
  fssaiNo: string | null;
  address: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  defaultTaxRateBps: number;
  billNumberPrefix: string | null;
  receiptFooterText: string;
  maxDiscountBps: number | null;
  kotWarningMinutes: number;
  kotUrgentMinutes: number;
  autoRestock: boolean;
  autoRestockTime: string;
}

export async function getSettings(db: Queryable, outletId: string): Promise<OutletSettings | null> {
  const { rows } = await db.query<{
    id: string;
    name: string;
    legal_name: string | null;
    gstin: string | null;
    fssai_no: string | null;
    address: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    phone: string | null;
    email: string | null;
    default_tax_rate_bps: number;
    bill_number_prefix: string | null;
    receipt_footer_text: string;
    max_discount_bps: number | null;
    kot_warning_minutes: number;
    kot_urgent_minutes: number;
    auto_restock: boolean;
    auto_restock_time: string;
  }>(
    `SELECT id, name, legal_name, gstin, fssai_no, address,
            address_line1, address_line2, city, state, pincode,
            phone, email, default_tax_rate_bps, bill_number_prefix,
            receipt_footer_text, max_discount_bps, kot_warning_minutes,
            kot_urgent_minutes, auto_restock, auto_restock_time
       FROM outlets WHERE id = $1`,
    [outletId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    legalName: r.legal_name,
    gstin: r.gstin,
    fssaiNo: r.fssai_no,
    address: r.address,
    addressLine1: r.address_line1,
    addressLine2: r.address_line2,
    city: r.city,
    state: r.state,
    pincode: r.pincode,
    phone: r.phone,
    email: r.email,
    defaultTaxRateBps: r.default_tax_rate_bps,
    billNumberPrefix: r.bill_number_prefix,
    receiptFooterText: r.receipt_footer_text,
    maxDiscountBps: r.max_discount_bps,
    kotWarningMinutes: r.kot_warning_minutes,
    kotUrgentMinutes: r.kot_urgent_minutes,
    autoRestock: r.auto_restock,
    autoRestockTime: r.auto_restock_time,
  };
}

/**
 * Generic partial-update helper. Builds SET clause from non-undefined keys.
 * Returns the updated row or null.
 */
export async function updateOutlet(
  db: Queryable,
  outletId: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return true;

  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of entries) {
    values.push(value);
    setClauses.push(`${toSnake(key)} = $${values.length}`);
  }
  values.push(outletId);
  const sql = `UPDATE outlets SET ${setClauses.join(', ')} WHERE id = $${values.length}`;
  const { rowCount } = await db.query(sql, values);
  return (rowCount ?? 0) > 0;
}

function toSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}
