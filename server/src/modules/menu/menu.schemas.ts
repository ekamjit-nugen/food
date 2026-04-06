import { z } from 'zod';

/**
 * Zod schemas for all menu-module HTTP inputs.
 *
 * Rules:
 *   - Every monetary field accepts integer paise. We refuse rupee decimals
 *     at the edge to force clients to be explicit about the unit.
 *   - IDs are UUIDs.
 *   - Names are trimmed and non-empty; we do not silently accept "  ".
 *   - We .strict() on objects so typos in the client payload 400 instead
 *     of being silently ignored.
 */

const uuid = z.string().uuid();
const paise = z.number().int().nonnegative();
const bps = z.number().int().min(0).max(10_000);
const nonEmptyName = z.string().trim().min(1).max(120);
const optionalText = z
  .string()
  .trim()
  .max(1000)
  .nullish()
  .transform((v) => (v === undefined || v === '' ? null : v));
const foodType = z.enum(['veg', 'non-veg', 'egg']);
const goodsOrServices = z.enum(['goods', 'services']);
const shortCode = z
  .string()
  .trim()
  .max(20)
  .nullish()
  .transform((v) => (v === undefined || v === '' ? null : v));
const hsnCode = z
  .string()
  .trim()
  .max(20)
  .nullish()
  .transform((v) => (v === undefined || v === '' ? null : v));

// -- Categories -------------------------------------------------------------
export const CreateCategorySchema = z
  .object({
    name: nonEmptyName,
    description: optionalText,
    parentId: uuid.nullish().transform((v) => v ?? null),
    displayOrder: z.number().int().nonnegative().default(0),
  })
  .strict();
export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;

export const UpdateCategorySchema = z
  .object({
    name: nonEmptyName.optional(),
    description: optionalText.optional(),
    parentId: uuid.nullish().transform((v) => v ?? null).optional(),
    displayOrder: z.number().int().nonnegative().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' });
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;

// -- Variations -------------------------------------------------------------
export const VariationInputSchema = z
  .object({
    id: uuid.optional(), // present when updating an existing variation
    name: nonEmptyName,
    priceDeltaPaise: z.number().int().default(0), // can be negative
    displayOrder: z.number().int().nonnegative().default(0),
    isActive: z.boolean().default(true),
  })
  .strict();
export type VariationInput = z.infer<typeof VariationInputSchema>;

// -- Items ------------------------------------------------------------------
export const CreateItemSchema = z
  .object({
    categoryId: uuid,
    name: nonEmptyName,
    description: optionalText,
    pricePaise: paise,
    taxRateBps: bps.default(500),
    inStock: z.boolean().default(true),
    displayOrder: z.number().int().nonnegative().default(0),
    imageUrl: z.string().url().max(2048).nullish(),
    foodType: foodType.default('veg'),
    shortCode: shortCode,
    hsnCode: hsnCode,
    packingChargePaise: paise.default(0),
    onlineName: optionalText,
    goodsOrServices: goodsOrServices.default('goods'),
    allowDecimalQty: z.boolean().default(false),
    variations: z.array(VariationInputSchema).max(20).default([]),
    addonIds: z.array(uuid).max(50).default([]),
    addonGroupIds: z.array(uuid).max(20).default([]),
  })
  .strict();
export type CreateItemInput = z.infer<typeof CreateItemSchema>;

export const UpdateItemSchema = z
  .object({
    categoryId: uuid.optional(),
    name: nonEmptyName.optional(),
    description: optionalText.optional(),
    pricePaise: paise.optional(),
    taxRateBps: bps.optional(),
    inStock: z.boolean().optional(),
    isActive: z.boolean().optional(),
    displayOrder: z.number().int().nonnegative().optional(),
    imageUrl: z.string().url().max(2048).nullish(),
    foodType: foodType.optional(),
    shortCode: shortCode.optional(),
    hsnCode: hsnCode.optional(),
    packingChargePaise: paise.optional(),
    onlineName: optionalText.optional(),
    goodsOrServices: goodsOrServices.optional(),
    allowDecimalQty: z.boolean().optional(),
    // If present, variations array is a full replacement (existing ids
    // that aren't in the new list are removed, new ones inserted, matching
    // ids updated). If absent, variations are left alone.
    variations: z.array(VariationInputSchema).max(20).optional(),
    // Same replacement semantics for addons.
    addonIds: z.array(uuid).max(50).optional(),
    addonGroupIds: z.array(uuid).max(20).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' });
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;

// -- Addons -----------------------------------------------------------------
export const CreateAddonSchema = z
  .object({
    name: nonEmptyName,
    pricePaise: paise.default(0),
  })
  .strict();
export type CreateAddonInput = z.infer<typeof CreateAddonSchema>;

export const UpdateAddonSchema = z
  .object({
    name: nonEmptyName.optional(),
    pricePaise: paise.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' });
export type UpdateAddonInput = z.infer<typeof UpdateAddonSchema>;

// -- Addon Groups -----------------------------------------------------------
export const CreateAddonGroupSchema = z
  .object({
    name: nonEmptyName,
    selectionType: z.enum(['single', 'multi']).default('multi'),
    minSelections: z.number().int().nonnegative().default(0),
    maxSelections: z.number().int().nonnegative().default(0),
    addonIds: z.array(uuid).max(50).default([]),
  })
  .strict();
export type CreateAddonGroupInput = z.infer<typeof CreateAddonGroupSchema>;

export const UpdateAddonGroupSchema = z
  .object({
    name: nonEmptyName.optional(),
    selectionType: z.enum(['single', 'multi']).optional(),
    minSelections: z.number().int().nonnegative().optional(),
    maxSelections: z.number().int().nonnegative().optional(),
    isActive: z.boolean().optional(),
    addonIds: z.array(uuid).max(50).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' });
export type UpdateAddonGroupInput = z.infer<typeof UpdateAddonGroupSchema>;

// -- URL params -------------------------------------------------------------
export const IdParamSchema = z.object({ id: uuid });
