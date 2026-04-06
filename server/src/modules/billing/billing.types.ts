export type BillStatus = 'open' | 'paid' | 'void';
export type DiscountType = 'flat' | 'percent';
export type PaymentMethod = 'cash' | 'upi' | 'card' | 'other';

export interface Bill {
  id: string;
  outletId: string;
  orderId: string;
  billNumber: number;
  subtotalPaise: number;
  discountType: DiscountType | null;
  /** For 'flat' = paise amount of the discount the client requested; for 'percent' = bps. */
  discountValue: number | null;
  discountPaise: number;
  discountReason: string | null;
  /** Sum of bill_items.lineDiscountPaise — denormalized for report reads. */
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
  voidedAt: Date | null;
  voidedBy: string | null;
  generatedBy: string;
  generatedAt: Date;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

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
  /** Stage-1 per-line discount (applied before bill-level). Never negative. */
  lineDiscountType: DiscountType | null;
  lineDiscountValue: number | null;
  lineDiscountPaise: number;
  lineDiscountReason: string | null;
  taxRateBps: number;
  cgstPaise: number;
  sgstPaise: number;
  lineTotalPaise: number;
  createdAt: Date;
}

export interface Payment {
  id: string;
  outletId: string;
  billId: string;
  method: PaymentMethod;
  amountPaise: number;
  reference: string | null;
  note: string | null;
  receivedBy: string;
  receivedAt: Date;
  isVoid: boolean;
  voidReason: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface BillDetail extends Bill {
  items: BillItem[];
  payments: Payment[];
}
