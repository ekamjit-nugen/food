import { pool } from '../../db/index.js';

/**
 * Small read-only helper for the PDF module. Fetches the header info we need
 * to stamp onto a bill or KOT reprint (restaurant name, outlet name/address,
 * GSTIN, FSSAI). Kept separate from billing/orders repositories because it
 * cuts across modules and is read-only.
 */
export interface PdfHeader {
  tenantName: string;
  outletName: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  gstin: string | null;
  fssaiNo: string | null;
  currency: string;
}

export async function loadHeader(outletId: string): Promise<PdfHeader | null> {
  const { rows } = await pool.query<{
    tenant_name: string;
    name: string;
    legal_name: string | null;
    address: string | null;
    phone: string | null;
    gstin: string | null;
    fssai_no: string | null;
    currency: string;
  }>(
    `SELECT t.name AS tenant_name,
            o.name, o.legal_name, o.address, o.phone,
            o.gstin, o.fssai_no, o.currency
       FROM outlets o
       JOIN tenants t ON t.id = o.tenant_id
      WHERE o.id = $1
      LIMIT 1`,
    [outletId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    tenantName: r.tenant_name,
    outletName: r.name,
    legalName: r.legal_name,
    address: r.address,
    phone: r.phone,
    gstin: r.gstin,
    fssaiNo: r.fssai_no,
    currency: r.currency,
  };
}
