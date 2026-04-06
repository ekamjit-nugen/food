import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import { orderKeys } from './orders';

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
    mutationFn: (orderId: string) => api.post<BillDetail>(`/orders/${orderId}/bill`, {}),
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

export function useRecordPayment(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { billId: string; input: RecordPaymentInput }) =>
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
      qc.invalidateQueries({ queryKey: orderKeys.open });
      qc.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
    },
  });
}
