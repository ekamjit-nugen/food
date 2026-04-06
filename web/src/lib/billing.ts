import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { orderKeys } from './orders';

/**
 * Billing types — mirror of server/src/modules/billing/billing.types.ts.
 *
 * Money is integer paise everywhere. Tax rates are basis points. The server
 * stores per-line tax so itemwise reports are accurate; the client just
 * renders whatever the server returns.
 */

export type BillStatus = 'open' | 'paid' | 'void';
export type DiscountType = 'flat' | 'percent';
export type PaymentMethod = 'cash' | 'upi' | 'card' | 'other';

export interface BillItem {
  id: string;
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
  createdAt: string;
}

export interface Payment {
  id: string;
  outletId: string;
  billId: string;
  method: PaymentMethod;
  amountPaise: number;
  reference: string | null;
  note: string | null;
  idempotencyKey: string | null;
  receivedBy: string;
  receivedAt: string;
  isVoid: boolean;
  voidReason: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  createdAt: string;
}

export interface Bill {
  id: string;
  outletId: string;
  orderId: string;
  billNumber: number;
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
  paidPaise: number;
  status: BillStatus;
  voidReason: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  generatedBy: string;
  generatedAt: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillDetail extends Bill {
  items: BillItem[];
  payments: Payment[];
}

export const billingKeys = {
  forOrder: (orderId: string) => ['billing', 'order', orderId] as const,
};

/**
 * Fetch the bill for an order. Returns null when the backend says 404 (no
 * bill generated yet) so the screen can render a "Generate bill" action
 * instead of bubbling an error banner. Any other error still throws.
 *
 * We deliberately do NOT handle the 409-on-split case here — split billing
 * has its own UI path (next slice). If the order has multiple bills this
 * will surface as an ApiError and the screen will show the message.
 */
export function useBillForOrder(orderId: string) {
  return useQuery<BillDetail | null>({
    queryKey: billingKeys.forOrder(orderId),
    queryFn: async () => {
      try {
        return await api.get<BillDetail>(`/orders/${orderId}/bill`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });
}

export function useGenerateBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) =>
      api.post<BillDetail>(`/orders/${orderId}/bill`, {}),
    onSuccess: (bill) => {
      qc.setQueryData(billingKeys.forOrder(bill.orderId), bill);
      qc.invalidateQueries({ queryKey: orderKeys.detail(bill.orderId) });
    },
  });
}

export interface RecordPaymentInput {
  idempotencyKey: string;
  method: PaymentMethod;
  amountPaise: number;
  reference?: string | null;
  note?: string | null;
}

/**
 * Record a payment against a bill. The backend's response envelope here is
 *   { bill: Bill, payment: Payment }
 * — note the flat `Bill`, not the hydrated `BillDetail`. We merge it into
 * the cached detail by keeping the existing items array and appending the
 * new payment to the payments array, so the screen updates instantly
 * without a second round-trip.
 */
/**
 * Discount payload the server accepts on PATCH /bills/:id/discount.
 * `flat` values are paise (max 1 Crore); `percent` values are basis points.
 * Pass `discount: null` to clear an existing discount.
 */
export type DiscountInput =
  | { type: 'flat'; valuePaise: number; reason: string }
  | { type: 'percent'; valueBps: number; reason: string }
  | null;

export interface UpdateDiscountInput {
  discount: DiscountInput;
}

export function useUpdateBillDiscount(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { billId: string; input: UpdateDiscountInput }) =>
      api.patch<BillDetail>(`/bills/${vars.billId}/discount`, vars.input),
    onSuccess: (bill) => {
      qc.setQueryData(billingKeys.forOrder(orderId), bill);
    },
  });
}

export function useVoidBill(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { billId: string; reason: string }) =>
      api.post<Bill>(`/bills/${vars.billId}/void`, { reason: vars.reason }),
    onSuccess: (bill) => {
      qc.setQueryData<BillDetail | null>(billingKeys.forOrder(orderId), (prev) => {
        if (!prev) return prev;
        return { ...prev, ...bill };
      });
      qc.invalidateQueries({ queryKey: orderKeys.open });
      qc.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
    },
  });
}

export function useRefundBill(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { billId: string; reason: string }) =>
      api.post<Bill>(`/bills/${vars.billId}/refund`, { reason: vars.reason }),
    onSuccess: (bill) => {
      qc.setQueryData<BillDetail | null>(billingKeys.forOrder(orderId), (prev) => {
        if (!prev) return prev;
        return { ...prev, ...bill };
      });
      qc.invalidateQueries({ queryKey: orderKeys.open });
      qc.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
    },
  });
}

/**
 * Void a single payment (correction flow). Server response is
 *   { bill: Bill, payment: Payment }
 * where `payment` is the now-voided row. We merge the scalar bill into the
 * cached detail and mark the matching payment as voided.
 */
export function useVoidPayment(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { billId: string; paymentId: string; reason: string }) =>
      api.post<{ bill: Bill; payment: Payment }>(
        `/bills/${vars.billId}/payments/${vars.paymentId}/void`,
        { reason: vars.reason },
      ),
    onSuccess: (res) => {
      qc.setQueryData<BillDetail | null>(billingKeys.forOrder(orderId), (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          ...res.bill,
          items: prev.items,
          payments: prev.payments.map((p) => (p.id === res.payment.id ? res.payment : p)),
        };
      });
      qc.invalidateQueries({ queryKey: orderKeys.open });
      qc.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
    },
  });
}

export function useRecordPayment(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { billId: string; input: RecordPaymentInput }) =>
      api.post<{ bill: Bill; payment: Payment }>(
        `/bills/${vars.billId}/payments`,
        vars.input,
      ),
    onSuccess: (res) => {
      qc.setQueryData<BillDetail | null>(billingKeys.forOrder(orderId), (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          ...res.bill,
          items: prev.items,
          payments: [...prev.payments, res.payment],
        };
      });
      // If the payment closed the order, the open-orders list is now stale.
      qc.invalidateQueries({ queryKey: orderKeys.open });
      qc.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
    },
  });
}
