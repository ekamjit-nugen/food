import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/**
 * Menu types — mirrored from server/src/modules/menu/menu.types.ts.
 *
 * We re-declare them here rather than sharing a package. The surface is
 * small, the duplication is obvious, and sharing a package would mean a
 * monorepo build step the project does not yet need. When the shapes drift
 * the typechecker screams because the field is undefined at the call site.
 */

export interface Category {
  id: string;
  outletId: string;
  name: string;
  description: string | null;
  parentId: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

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
  foodType: 'veg' | 'non-veg' | 'egg';
  shortCode: string | null;
  hsnCode: string | null;
  packingChargePaise: number;
  onlineName: string | null;
  goodsOrServices: 'goods' | 'services';
  allowDecimalQty: boolean;
  createdAt: string;
  updatedAt: string;
  variations: Variation[];
  addons: AddonRef[];
  addonGroups: AddonGroup[];
}

export interface AddonGroup {
  id: string;
  outletId: string;
  name: string;
  selectionType: 'single' | 'multi';
  minSelections: number;
  maxSelections: number;
  isActive: boolean;
  displayOrder: number;
  addons: AddonRef[];
  createdAt: string;
  updatedAt: string;
}

export interface ServiceMenuCategory extends Category {
  items: Item[];
}

export type ServiceMenu = ServiceMenuCategory[];

// Query keys are centralized so mutations can invalidate surgically. A flat
// string key is fine at this scale; add a factory if menu ever grows tenant
// or locale scoping.
export interface Addon {
  id: string;
  outletId: string;
  name: string;
  pricePaise: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const menuKeys = {
  service: ['menu', 'service'] as const,
  items: ['menu', 'items'] as const,
  categories: ['menu', 'categories'] as const,
  addons: ['menu', 'addons'] as const,
  addonGroups: ['menu', 'addonGroups'] as const,
};

/**
 * Helper used by every CRUD mutation below. Any menu mutation can invalidate
 * any consumer (admin category list, admin item list, POS service menu) so
 * we just wipe the whole menu namespace. Cheap on a small menu.
 */
function invalidateAllMenu(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['menu'] });
}

export function useServiceMenu() {
  return useQuery({
    queryKey: menuKeys.service,
    queryFn: async () => {
      const res = await api.get<{ data: ServiceMenu }>('/menu');
      return res.data;
    },
  });
}

export function useItems() {
  return useQuery({
    queryKey: menuKeys.items,
    queryFn: async () => {
      // includeInactive=true so admin can see and restore deactivated items.
      // POS never uses this hook — it calls useServiceMenu which already
      // filters to active + in-stock server-side.
      const res = await api.get<{ data: Item[] }>('/menu/items', {
        includeInactive: true,
      });
      return res.data;
    },
  });
}

export function useCategories() {
  return useQuery({
    queryKey: menuKeys.categories,
    queryFn: async () => {
      const res = await api.get<{ data: Category[] }>('/menu/categories', {
        includeInactive: true,
      });
      return res.data;
    },
  });
}

export function useAddons() {
  return useQuery({
    queryKey: menuKeys.addons,
    queryFn: async () => {
      const res = await api.get<{ data: Addon[] }>('/menu/addons', {
        includeInactive: true,
      });
      return res.data;
    },
  });
}

// -- Category CRUD ---------------------------------------------------------
export interface CategoryCreateInput {
  name: string;
  description?: string | null;
  parentId?: string | null;
  displayOrder?: number;
}
export interface CategoryUpdateInput {
  name?: string;
  description?: string | null;
  parentId?: string | null;
  displayOrder?: number;
  isActive?: boolean;
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CategoryCreateInput) => api.post<Category>('/menu/categories', input),
    onSuccess: () => invalidateAllMenu(qc),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: CategoryUpdateInput }) =>
      api.patch<Category>(`/menu/categories/${vars.id}`, vars.input),
    onSuccess: () => invalidateAllMenu(qc),
  });
}

export function useDeactivateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<Category>(`/menu/categories/${id}`),
    onSuccess: () => invalidateAllMenu(qc),
  });
}

// -- Item CRUD -------------------------------------------------------------
/**
 * Inputs mirror the zod schemas on the server. `variations` is a full
 * replacement on PATCH: server removes missing ids, updates matching ids,
 * inserts new ones. Same for `addonIds`. If you omit the field it is left
 * untouched — we let the caller choose.
 */
export interface VariationInput {
  id?: string;
  name: string;
  priceDeltaPaise?: number;
  displayOrder?: number;
  isActive?: boolean;
}
export interface ItemCreateInput {
  categoryId: string;
  name: string;
  description?: string | null;
  pricePaise: number;
  taxRateBps?: number;
  inStock?: boolean;
  displayOrder?: number;
  imageUrl?: string | null;
  foodType?: 'veg' | 'non-veg' | 'egg';
  shortCode?: string | null;
  hsnCode?: string | null;
  packingChargePaise?: number;
  onlineName?: string | null;
  goodsOrServices?: 'goods' | 'services';
  allowDecimalQty?: boolean;
  variations?: VariationInput[];
  addonIds?: string[];
  addonGroupIds?: string[];
}
export interface ItemUpdateInput {
  categoryId?: string;
  name?: string;
  description?: string | null;
  pricePaise?: number;
  taxRateBps?: number;
  inStock?: boolean;
  isActive?: boolean;
  displayOrder?: number;
  imageUrl?: string | null;
  foodType?: 'veg' | 'non-veg' | 'egg';
  shortCode?: string | null;
  hsnCode?: string | null;
  packingChargePaise?: number;
  onlineName?: string | null;
  goodsOrServices?: 'goods' | 'services';
  allowDecimalQty?: boolean;
  variations?: VariationInput[];
  addonIds?: string[];
  addonGroupIds?: string[];
}

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ItemCreateInput) => api.post<Item>('/menu/items', input),
    onSuccess: () => invalidateAllMenu(qc),
  });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: ItemUpdateInput }) =>
      api.patch<Item>(`/menu/items/${vars.id}`, vars.input),
    onSuccess: () => invalidateAllMenu(qc),
  });
}

export function useDeactivateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<Item>(`/menu/items/${id}`),
    onSuccess: () => invalidateAllMenu(qc),
  });
}

/**
 * Toggle an item's in-stock flag. This is the single most common menu edit
 * during service ("we've run out of paneer tikka") so it gets its own fast
 * path on the backend and an optimistic update here.
 */
export function useSetItemInStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { itemId: string; inStock: boolean }) => {
      return api.post<Item>(`/menu/items/${vars.itemId}/in-stock`, {
        inStock: vars.inStock,
      });
    },
    onSuccess: () => {
      // Invalidate both caches: admin table and POS service menu. The POS
      // user may be looking at the grid while admin toggles stock on another
      // device; TanStack will refetch when focus returns or the component
      // remounts.
      qc.invalidateQueries({ queryKey: menuKeys.items });
      qc.invalidateQueries({ queryKey: menuKeys.service });
    },
  });
}

// -- Addon CRUD -------------------------------------------------------------
export interface AddonCreateInput {
  name: string;
  pricePaise?: number;
}
export interface AddonUpdateInput {
  name?: string;
  pricePaise?: number;
  isActive?: boolean;
}

export function useCreateAddon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddonCreateInput) => api.post<Addon>('/menu/addons', input),
    onSuccess: () => invalidateAllMenu(qc),
  });
}

export function useUpdateAddon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: AddonUpdateInput }) =>
      api.patch<Addon>(`/menu/addons/${vars.id}`, vars.input),
    onSuccess: () => invalidateAllMenu(qc),
  });
}

export function useDeactivateAddon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<Addon>(`/menu/addons/${id}`),
    onSuccess: () => invalidateAllMenu(qc),
  });
}

// -- Addon Group CRUD -------------------------------------------------------
export interface AddonGroupCreateInput {
  name: string;
  selectionType?: 'single' | 'multi';
  minSelections?: number;
  maxSelections?: number;
  addonIds?: string[];
}
export interface AddonGroupUpdateInput {
  name?: string;
  selectionType?: 'single' | 'multi';
  minSelections?: number;
  maxSelections?: number;
  isActive?: boolean;
  addonIds?: string[];
}

export function useAddonGroups() {
  return useQuery({
    queryKey: menuKeys.addonGroups,
    queryFn: async () => {
      const res = await api.get<{ data: AddonGroup[] }>('/menu/addon-groups', {
        includeInactive: true,
      });
      return res.data;
    },
  });
}

export function useCreateAddonGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddonGroupCreateInput) => api.post<AddonGroup>('/menu/addon-groups', input),
    onSuccess: () => invalidateAllMenu(qc),
  });
}

export function useUpdateAddonGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: AddonGroupUpdateInput }) =>
      api.patch<AddonGroup>(`/menu/addon-groups/${vars.id}`, vars.input),
    onSuccess: () => invalidateAllMenu(qc),
  });
}

export function useDeactivateAddonGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<AddonGroup>(`/menu/addon-groups/${id}`),
    onSuccess: () => invalidateAllMenu(qc),
  });
}
