import { z } from 'zod';

/**
 * Input schemas for the orders module.
 *
 * Pricing is NEVER taken from the client. The client sends
 * `{ menuItemId, variationId?, addonIds[], quantity }` and the server
 * resolves names and paise values from the current menu. This is the
 * single most important rule in this module — letting a client tell the
 * server what something costs is a foot-gun that never stops shooting.
 */

const uuid = z.string().uuid();

/** One line the POS is adding to an order as a draft. */
export const DraftOrderItemSchema = z
  .object({
    menuItemId: uuid,
    variationId: uuid.optional(),
    addonIds: z.array(uuid).max(20).default([]),
    quantity: z.number().int().min(1).max(999),
    notes: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((v) => (v === undefined || v === '' ? null : v)),
  })
  .strict();
export type DraftOrderItemInput = z.infer<typeof DraftOrderItemSchema>;

export const CreateOrderSchema = z
  .object({
    orderType: z.enum(['dine_in', 'takeaway']).default('dine_in'),
    tableId: uuid.optional(),
    customerName: z
      .string()
      .trim()
      .max(120)
      .nullish()
      .transform((v) => (v === undefined || v === '' ? null : v)),
    customerPhone: z
      .string()
      .trim()
      .max(32)
      .nullish()
      .transform((v) => (v === undefined || v === '' ? null : v)),
    pax: z.number().int().min(1).max(100).optional(),
    notes: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((v) => (v === undefined || v === '' ? null : v)),
    // Optional: open the order AND add initial draft items in one call.
    // These are still drafts — they are not dispatched to the kitchen
    // until an explicit /items/send call.
    items: z.array(DraftOrderItemSchema).max(100).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.orderType === 'dine_in' && !v.tableId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tableId'],
        message: 'tableId is required for dine_in orders',
      });
    }
    if (v.orderType === 'takeaway' && v.tableId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tableId'],
        message: 'takeaway orders must not reference a table',
      });
    }
  });
export type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

export const AddOrderItemsSchema = z
  .object({
    items: z.array(DraftOrderItemSchema).min(1).max(100),
  })
  .strict();
export type AddOrderItemsInput = z.infer<typeof AddOrderItemsSchema>;

export const VoidOrderItemSchema = z
  .object({
    reason: z.string().trim().min(1).max(200),
  })
  .strict();
export type VoidOrderItemInput = z.infer<typeof VoidOrderItemSchema>;

export const CancelOrderSchema = z
  .object({
    reason: z.string().trim().min(1).max(200),
  })
  .strict();
export type CancelOrderInput = z.infer<typeof CancelOrderSchema>;

/**
 * KOT state transitions the client can request. `new` is omitted — KOTs
 * are born new, never returned to it. `void` is allowed (needs reason).
 */
export const UpdateKotStatusSchema = z
  .object({
    status: z.enum(['in_progress', 'ready', 'served', 'void']),
    reason: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.status === 'void' && !v.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'reason is required when voiding a KOT',
      });
    }
  });
export type UpdateKotStatusInput = z.infer<typeof UpdateKotStatusSchema>;

export const ListOrdersQuerySchema = z
  .object({
    status: z.enum(['open', 'closed', 'cancelled']).optional(),
    tableId: uuid.optional(),
  })
  .strict();
export type ListOrdersQueryInput = z.infer<typeof ListOrdersQuerySchema>;

export const ListKotsQuerySchema = z
  .object({
    status: z.enum(['new', 'in_progress', 'ready', 'served', 'void']).optional(),
    /** Convenience: "active" = new | in_progress | ready. What the KDS asks for on connect. */
    active: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
  })
  .strict();
export type ListKotsQueryInput = z.infer<typeof ListKotsQuerySchema>;

export const IdParamSchema = z.object({ id: uuid });
export const OrderItemIdParamSchema = z.object({ id: uuid, itemId: uuid });
