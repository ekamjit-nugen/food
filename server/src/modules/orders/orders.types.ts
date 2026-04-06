/**
 * Domain types for the orders module.
 *
 * Money is always integer paise. Tax rates are basis points. Dates are
 * JS Date (node-postgres parses TIMESTAMPTZ natively). Anything coming in
 * as BIGINT from pg is converted to `number` at the repository boundary —
 * no string-paise in the service layer.
 */

export type OrderType = 'dine_in' | 'takeaway';
export type OrderStatus = 'open' | 'closed' | 'cancelled';
export type KotStatus = 'new' | 'in_progress' | 'ready' | 'served' | 'void';

export interface OrderItemAddon {
  id: string;
  name: string;
  pricePaise: number;
}

export interface OrderItem {
  id: string;
  outletId: string;
  orderId: string;
  kotId: string | null;
  menuItemId: string;
  menuItemName: string;
  variationId: string | null;
  variationName: string | null;
  unitPricePaise: number;
  taxRateBps: number;
  addons: OrderItemAddon[];
  quantity: number;
  notes: string | null;
  isVoid: boolean;
  voidReason: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Kot {
  id: string;
  outletId: string;
  orderId: string;
  kotNumber: number;
  status: KotStatus;
  sentBy: string;
  sentAt: Date;
  startedAt: Date | null;
  readyAt: Date | null;
  servedAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Order {
  id: string;
  outletId: string;
  orderNumber: number;
  orderType: OrderType;
  tableId: string | null;
  status: OrderStatus;
  customerName: string | null;
  customerPhone: string | null;
  pax: number | null;
  notes: string | null;
  openedBy: string;
  openedAt: Date;
  closedAt: Date | null;
  cancelledAt: Date | null;
  cancelledReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Hydrated view returned from GET /orders/:id and as the detail payload on KDS events. */
export interface OrderDetail extends Order {
  items: OrderItem[];
  kots: Kot[];
}

/** Hydrated KOT view broadcast to the KDS. */
export interface KotWithItems extends Kot {
  items: OrderItem[];
  /** Denormalised from the parent order so KDS can render without extra fetches. */
  order: {
    id: string;
    orderNumber: number;
    orderType: OrderType;
    tableId: string | null;
    tableCode: string | null;
  };
}
