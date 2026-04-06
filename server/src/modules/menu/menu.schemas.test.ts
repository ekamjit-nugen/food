import { describe, it, expect } from 'vitest';
import {
  CreateAddonGroupSchema,
  CreateCategorySchema,
  CreateItemSchema,
  UpdateAddonGroupSchema,
  UpdateCategorySchema,
  UpdateItemSchema,
  CreateAddonSchema,
} from './menu.schemas.js';

const uuid = '11111111-1111-1111-1111-111111111111';

describe('menu.schemas', () => {
  describe('CreateCategorySchema', () => {
    it('accepts a minimal valid input', () => {
      const r = CreateCategorySchema.parse({ name: 'Starters' });
      expect(r.name).toBe('Starters');
      expect(r.displayOrder).toBe(0);
      expect(r.description).toBeNull();
    });

    it('trims names', () => {
      const r = CreateCategorySchema.parse({ name: '  Mains  ' });
      expect(r.name).toBe('Mains');
    });

    it('rejects empty name', () => {
      expect(() => CreateCategorySchema.parse({ name: '   ' })).toThrow();
    });

    it('rejects unknown fields (strict)', () => {
      expect(() =>
        CreateCategorySchema.parse({ name: 'X', displayOrder: 1, foo: 'bar' }),
      ).toThrow();
    });

    it('defaults parentId to null when omitted', () => {
      const r = CreateCategorySchema.parse({ name: 'Starters' });
      expect(r.parentId).toBeNull();
    });

    it('accepts parentId as valid UUID', () => {
      const r = CreateCategorySchema.parse({ name: 'Sub', parentId: uuid });
      expect(r.parentId).toBe(uuid);
    });

    it('transforms undefined parentId to null', () => {
      const r = CreateCategorySchema.parse({ name: 'Sub', parentId: undefined });
      expect(r.parentId).toBeNull();
    });
  });

  describe('UpdateCategorySchema', () => {
    it('requires at least one field', () => {
      expect(() => UpdateCategorySchema.parse({})).toThrow();
    });
    it('accepts a partial update', () => {
      expect(UpdateCategorySchema.parse({ isActive: false })).toEqual({ isActive: false });
    });
  });

  describe('CreateItemSchema', () => {
    const base = { categoryId: uuid, name: 'Paneer Tikka', pricePaise: 25_000 };

    it('accepts minimal input and applies defaults', () => {
      const r = CreateItemSchema.parse(base);
      expect(r.taxRateBps).toBe(500);
      expect(r.inStock).toBe(true);
      expect(r.variations).toEqual([]);
      expect(r.addonIds).toEqual([]);
    });

    it('rejects negative price', () => {
      expect(() => CreateItemSchema.parse({ ...base, pricePaise: -1 })).toThrow();
    });

    it('rejects non-integer price', () => {
      expect(() => CreateItemSchema.parse({ ...base, pricePaise: 100.5 })).toThrow();
    });

    it('rejects tax rate above 100%', () => {
      expect(() => CreateItemSchema.parse({ ...base, taxRateBps: 10_001 })).toThrow();
    });

    it('accepts a variation with negative delta (smaller size = cheaper)', () => {
      const r = CreateItemSchema.parse({
        ...base,
        variations: [{ name: 'Half', priceDeltaPaise: -5000 }],
      });
      expect(r.variations[0]).toMatchObject({ name: 'Half', priceDeltaPaise: -5000 });
    });

    it('caps variations at 20', () => {
      const variations = Array.from({ length: 21 }, (_, i) => ({
        name: `V${i}`,
        priceDeltaPaise: 0,
      }));
      expect(() => CreateItemSchema.parse({ ...base, variations })).toThrow();
    });

    it('rejects malformed addon ids', () => {
      expect(() =>
        CreateItemSchema.parse({ ...base, addonIds: ['not-a-uuid'] }),
      ).toThrow();
    });

    it('defaults foodType to veg', () => {
      const r = CreateItemSchema.parse(base);
      expect(r.foodType).toBe('veg');
    });

    it('accepts non-veg and egg foodType', () => {
      expect(CreateItemSchema.parse({ ...base, foodType: 'non-veg' }).foodType).toBe('non-veg');
      expect(CreateItemSchema.parse({ ...base, foodType: 'egg' }).foodType).toBe('egg');
    });

    it('rejects invalid foodType', () => {
      expect(() => CreateItemSchema.parse({ ...base, foodType: 'vegan' })).toThrow();
    });

    it('trims and nullifies empty shortCode', () => {
      expect(CreateItemSchema.parse({ ...base, shortCode: '  ' }).shortCode).toBeNull();
      expect(CreateItemSchema.parse({ ...base, shortCode: ' SC1 ' }).shortCode).toBe('SC1');
    });

    it('defaults packingChargePaise to 0 and rejects negative', () => {
      expect(CreateItemSchema.parse(base).packingChargePaise).toBe(0);
      expect(() => CreateItemSchema.parse({ ...base, packingChargePaise: -1 })).toThrow();
    });

    it('defaults goodsOrServices to goods and rejects invalid', () => {
      expect(CreateItemSchema.parse(base).goodsOrServices).toBe('goods');
      expect(() => CreateItemSchema.parse({ ...base, goodsOrServices: 'both' })).toThrow();
    });

    it('defaults allowDecimalQty to false', () => {
      expect(CreateItemSchema.parse(base).allowDecimalQty).toBe(false);
    });

    it('defaults addonGroupIds to empty array', () => {
      const r = CreateItemSchema.parse(base);
      expect(r.addonGroupIds).toEqual([]);
    });

    it('accepts addonGroupIds with valid UUIDs', () => {
      const r = CreateItemSchema.parse({ ...base, addonGroupIds: [uuid] });
      expect(r.addonGroupIds).toEqual([uuid]);
    });
  });

  describe('UpdateItemSchema', () => {
    it('requires at least one field', () => {
      expect(() => UpdateItemSchema.parse({})).toThrow();
    });
    it('allows flipping in_stock alone', () => {
      expect(UpdateItemSchema.parse({ inStock: false })).toEqual({ inStock: false });
    });
  });

  describe('CreateAddonSchema', () => {
    it('defaults pricePaise to 0 for free add-ons', () => {
      expect(CreateAddonSchema.parse({ name: 'Extra spicy' })).toEqual({
        name: 'Extra spicy',
        pricePaise: 0,
      });
    });
  });

  describe('CreateAddonGroupSchema', () => {
    it('accepts minimal input and applies defaults', () => {
      const r = CreateAddonGroupSchema.parse({ name: 'Toppings' });
      expect(r.name).toBe('Toppings');
      expect(r.selectionType).toBe('multi');
      expect(r.minSelections).toBe(0);
      expect(r.maxSelections).toBe(0);
      expect(r.addonIds).toEqual([]);
    });

    it('accepts single selection type', () => {
      const r = CreateAddonGroupSchema.parse({ name: 'Size', selectionType: 'single' });
      expect(r.selectionType).toBe('single');
    });

    it('rejects invalid selection type', () => {
      expect(() => CreateAddonGroupSchema.parse({ name: 'X', selectionType: 'any' })).toThrow();
    });

    it('rejects negative minSelections', () => {
      expect(() => CreateAddonGroupSchema.parse({ name: 'X', minSelections: -1 })).toThrow();
    });
  });

  describe('UpdateAddonGroupSchema', () => {
    it('requires at least one field', () => {
      expect(() => UpdateAddonGroupSchema.parse({})).toThrow();
    });

    it('accepts a partial update', () => {
      expect(UpdateAddonGroupSchema.parse({ isActive: false })).toEqual({ isActive: false });
    });
  });
});
