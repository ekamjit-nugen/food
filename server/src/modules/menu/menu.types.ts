/**
 * Domain types for the menu module.
 *
 * These are the canonical shapes returned by the service layer. Database
 * column naming is snake_case; the service layer converts to camelCase once,
 * at the repository boundary. Controllers and HTTP responses use these types
 * directly — no further mapping.
 */

export interface Category {
  id: string;
  outletId: string;
  name: string;
  description: string | null;
  parentId: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
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
  createdAt: Date;
  updatedAt: Date;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface Addon {
  id: string;
  outletId: string;
  name: string;
  pricePaise: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ServiceMenu — the shape consumed by the POS/order app. A single query
 * returns the entire active menu for an outlet, categories nested with
 * their items. Kept denormalised on purpose so the POS can render without
 * chasing joins.
 */
export interface ServiceMenuCategory extends Category {
  items: Item[];
}

export type ServiceMenu = ServiceMenuCategory[];
