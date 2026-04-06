import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/**
 * Reports hooks.
 *
 * Five read-only reports aggregated from paid bills. Everything is scoped by
 * a [from, to) half-open time range in ISO-8601. The backend re-echoes the
 * range in the envelope so the client can stamp printouts.
 *
 * Types mirror server/src/modules/reports/reports.repository.ts.
 */

export type ReportScope = 'outlet' | 'tenant';

export interface ReportEnvelope<T> {
  range: { from: string; to: string };
  scope: ReportScope;
  outletIds: string[];
  data: T;
}

export type OrderType = 'dine_in' | 'takeaway';
export type OrderStatus = 'open' | 'closed' | 'cancelled';
export type BillStatus = 'open' | 'paid' | 'void';
export type PaymentMethod = 'cash' | 'upi' | 'card' | 'other';

export interface DailySalesRow {
  totalBills: number;
  totalRevenuePaise: number;
  totalTaxPaise: number;
  totalDiscountPaise: number;
  totalRoundOffPaise: number;
  byOrderType: Array<{ orderType: OrderType; bills: number; revenuePaise: number }>;
  byPaymentMethod: Array<{ method: PaymentMethod; payments: number; amountPaise: number }>;
  byOutlet: Array<{
    outletId: string;
    outletName: string;
    bills: number;
    revenuePaise: number;
  }>;
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

export interface CategorySalesRow {
  categoryId: string | null;
  categoryName: string | null;
  quantity: number;
  netPaise: number;
}

export interface TaxSummaryRow {
  taxRateBps: number;
  taxableBasePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalTaxPaise: number;
}

export interface OrderMasterRow {
  orderId: string;
  orderNumber: number;
  orderType: OrderType;
  status: OrderStatus;
  outletId: string;
  outletName: string;
  tableCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  openedAt: string;
  closedAt: string | null;
  billId: string | null;
  billNumber: number | null;
  billStatus: BillStatus | null;
  subtotalPaise: number | null;
  discountPaise: number | null;
  taxPaise: number | null;
  totalPaise: number | null;
  openedByEmail: string | null;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface ReportQuery extends DateRange {
  scope: ReportScope;
}

function rangeQuery(q: ReportQuery): Record<string, string> {
  // Only include `scope` on the wire when it is 'tenant' — the server
  // defaults missing scope to 'outlet', and omitting it keeps URLs shorter
  // and matches pre-Phase-6 request shape for the single-outlet case.
  const out: Record<string, string> = { from: q.from, to: q.to };
  if (q.scope === 'tenant') out.scope = 'tenant';
  return out;
}

export const reportKeys = {
  daily: (q: ReportQuery) => ['reports', 'daily', q.from, q.to, q.scope] as const,
  item: (q: ReportQuery) => ['reports', 'item', q.from, q.to, q.scope] as const,
  category: (q: ReportQuery) =>
    ['reports', 'category', q.from, q.to, q.scope] as const,
  tax: (q: ReportQuery) => ['reports', 'tax', q.from, q.to, q.scope] as const,
  orderMaster: (q: ReportQuery) =>
    ['reports', 'orderMaster', q.from, q.to, q.scope] as const,
};

export function useDailySales(q: ReportQuery) {
  return useQuery({
    queryKey: reportKeys.daily(q),
    queryFn: () =>
      api.get<ReportEnvelope<DailySalesRow>>('/reports/daily-sales', rangeQuery(q)),
  });
}

export function useItemWiseSales(q: ReportQuery) {
  return useQuery({
    queryKey: reportKeys.item(q),
    queryFn: () =>
      api.get<ReportEnvelope<ItemSalesRow[]>>('/reports/item-wise', rangeQuery(q)),
  });
}

export function useCategoryWiseSales(q: ReportQuery) {
  return useQuery({
    queryKey: reportKeys.category(q),
    queryFn: () =>
      api.get<ReportEnvelope<CategorySalesRow[]>>('/reports/category-wise', rangeQuery(q)),
  });
}

export function useTaxSummary(q: ReportQuery) {
  return useQuery({
    queryKey: reportKeys.tax(q),
    queryFn: () =>
      api.get<ReportEnvelope<TaxSummaryRow[]>>('/reports/tax-summary', rangeQuery(q)),
  });
}

export function useOrderMaster(q: ReportQuery) {
  return useQuery({
    queryKey: reportKeys.orderMaster(q),
    queryFn: () =>
      api.get<ReportEnvelope<OrderMasterRow[]>>('/reports/order-master', rangeQuery(q)),
  });
}

/**
 * Download the order-master report as CSV.
 *
 * The `/reports/*` routes gate on Authorization header only (not ?token=),
 * so we can't hand the URL to the browser as a plain anchor. Instead we
 * fetch with the bearer token, turn the response body into a blob, and
 * trigger a click on an off-DOM anchor. Memory is cleaned up via
 * URL.revokeObjectURL on a microtask.
 */
export async function downloadOrderMasterCsv(
  query: ReportQuery,
  token: string,
): Promise<void> {
  const params = new URLSearchParams({
    from: query.from,
    to: query.to,
    format: 'csv',
  });
  if (query.scope === 'tenant') params.set('scope', 'tenant');
  const res = await fetch(`/api/v1/reports/order-master?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orders-${query.from.slice(0, 10)}-to-${query.to.slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  queueMicrotask(() => URL.revokeObjectURL(url));
}
