import type { AuthContext } from '../../middleware/auth.js';
import { NotFound } from '../../utils/errors.js';
import * as billingService from '../billing/billing.service.js';
import * as ordersService from '../orders/orders.service.js';
import { renderBillPdf } from './bill-pdf.js';
import { renderKotPdf } from './kot-pdf.js';
import { loadHeader } from './pdf.repository.js';

/**
 * PDF reprint orchestrators. Fetch the domain object through the existing
 * outlet-scoped service reads (which already throw NotFound on cross-tenant
 * access) and then render. The renderers themselves are pure — they take a
 * hydrated object and a header and return a Buffer.
 */

export async function renderBill(
  actor: AuthContext,
  billId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  // getBillDetail already enforces actor.outletId scoping.
  const bill = await billingService.getBillDetail(actor, billId);
  const header = await loadHeader(bill.outletId);
  if (!header) throw NotFound('outlet header');
  const buffer = await renderBillPdf(bill, header);
  return { buffer, filename: `bill-${bill.billNumber}.pdf` };
}

export async function renderKot(
  actor: AuthContext,
  kotId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const kot = await ordersService.getKotDetail(actor, kotId);
  const header = await loadHeader(kot.outletId);
  if (!header) throw NotFound('outlet header');
  const buffer = await renderKotPdf(kot, header);
  return { buffer, filename: `kot-${kot.kotNumber}.pdf` };
}
