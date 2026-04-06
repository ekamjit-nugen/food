import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/**
 * Order types — mirror of server/src/modules/orders/orders.types.ts.
 * Dates are strings on the wire; we don't parse them to Date objects in the
 * client because nothing in the UI currently needs Date math.
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
  voidedAt: string | null;
  voidedBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Kot {
  id: string;
  outletId: string;
  orderId: string;
  kotNumber: number;
  status: KotStatus;
  sentBy: string;
  sentAt: string;
  startedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  updatedAt: string;
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
  openedAt: string;
  closedAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderDetail extends Order {
  items: OrderItem[];
  kots: Kot[];
}

/** What the POS sends when adding a line. Server resolves price + name. */
export interface DraftOrderItemInput {
  menuItemId: string;
  variationId?: string;
  addonIds?: string[];
  quantity: number;
  notes?: string | null;
}

export interface CreateOrderInput {
  orderType: OrderType;
  tableId?: string;
  customerName?: string | null;
  customerPhone?: string | null;
  pax?: number;
  notes?: string | null;
  items?: DraftOrderItemInput[];
}

export const orderKeys = {
  open: ['orders', 'open'] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
};

/**
 * List open orders. Used by the table grid to decide which tables are
 * occupied. Kept at 5s stale so the grid feels live without being chatty.
 */
export function useOpenOrders() {
  return useQuery({
    queryKey: orderKeys.open,
    queryFn: async () => {
      const res = await api.get<{ data: Order[] }>('/orders', { status: 'open' });
      return res.data;
    },
    staleTime: 5_000,
  });
}

export function useOrderDetail(orderId: string | null) {
  return useQuery({
    queryKey: orderId ? orderKeys.detail(orderId) : ['orders', 'detail', 'none'],
    queryFn: async () => {
      if (!orderId) throw new Error('no order id');
      return api.get<OrderDetail>(`/orders/${orderId}`);
    },
    enabled: !!orderId,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateOrderInput) => api.post<OrderDetail>('/orders', input),
    onSuccess: (order) => {
      qc.invalidateQueries({ queryKey: orderKeys.open });
      qc.setQueryData(orderKeys.detail(order.id), order);
    },
  });
}

export function useAddOrderItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { orderId: string; items: DraftOrderItemInput[] }) => {
      return api.post<{ data: OrderItem[] }>(`/orders/${vars.orderId}/items`, {
        items: vars.items,
      });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: orderKeys.detail(vars.orderId) });
      qc.invalidateQueries({ queryKey: orderKeys.open });
    },
  });
}

/**
 * Dispatch all draft items on an order to the kitchen. Creates a KOT and
 * flips the items out of draft. Idempotent on "no drafts" (backend 409s).
 */
export function useSendDraftItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: string) => api.post<Kot>(`/orders/${orderId}/items/send`),
    onSuccess: (_kot, orderId) => {
      qc.invalidateQueries({ queryKey: orderKeys.detail(orderId) });
      qc.invalidateQueries({ queryKey: orderKeys.open });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { orderId: string; reason: string }) =>
      api.post<Order>(`/orders/${vars.orderId}/cancel`, { reason: vars.reason }),
    onSuccess: (_order, vars) => {
      qc.invalidateQueries({ queryKey: orderKeys.detail(vars.orderId) });
      qc.invalidateQueries({ queryKey: orderKeys.open });
    },
  });
}
