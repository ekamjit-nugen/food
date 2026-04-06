import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/**
 * Subset of server/src/modules/menu/menu.types.ts. The mobile app only needs
 * to read the service menu; category/item/addon admin lives on the web.
 */

export interface Variation {
  id: string;
  itemId: string;
  name: string;
  priceDeltaPaise: number;
  displayOrder: number;
  isActive: boolean;
}

export interface AddonRef {
  id: string;
  name: string;
  pricePaise: number;
}

export interface Item {
  id: string;
  outletId: string;
  categoryId: string;
  name: string;
  description: string | null;
  pricePaise: number;
  taxRateBps: number;
  inStock: boolean;
  isActive: boolean;
  displayOrder: number;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  variations: Variation[];
  addons: AddonRef[];
}

export interface ServiceMenuCategory {
  id: string;
  outletId: string;
  name: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  items: Item[];
}

export type ServiceMenu = ServiceMenuCategory[];

export const menuKeys = {
  service: ['menu', 'service'] as const,
  items: ['menu', 'items'] as const,
};

export function useServiceMenu() {
  return useQuery({
    queryKey: menuKeys.service,
    queryFn: async () => {
      const res = await api.get<{ data: ServiceMenu }>('/menu');
      return res.data;
    },
  });
}

/**
 * Admin view of items: includes inactive + out-of-stock rows so managers
 * can toggle stock during service. Mirrors web's useItems hook.
 */
export function useMenuItems() {
  return useQuery({
    queryKey: menuKeys.items,
    queryFn: async () => {
      const res = await api.get<{ data: Item[] }>('/menu/items', { includeInactive: true });
      return res.data;
    },
  });
}

/**
 * Fast-path for "we've run out of paneer tikka". Optimistically toggles the
 * local cache then reconciles with the server response so the switch feels
 * instant on a busy floor. Server requires admin/manager — StockScreen
 * hides itself for staff so the failure is impossible to hit via the UI.
 */
export function useSetItemInStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { itemId: string; inStock: boolean }) =>
      api.post<Item>(`/menu/items/${vars.itemId}/in-stock`, { inStock: vars.inStock }),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: menuKeys.items });
      const prev = qc.getQueryData<Item[]>(menuKeys.items);
      if (prev) {
        qc.setQueryData<Item[]>(
          menuKeys.items,
          prev.map((i) => (i.id === vars.itemId ? { ...i, inStock: vars.inStock } : i)),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(menuKeys.items, ctx.prev);
    },
    onSettled: () => {
      // Service menu has inStock baked in via filtering — refetch it too.
      qc.invalidateQueries({ queryKey: menuKeys.items });
      qc.invalidateQueries({ queryKey: menuKeys.service });
    },
  });
}
