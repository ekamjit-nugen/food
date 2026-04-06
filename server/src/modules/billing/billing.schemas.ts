import { z } from 'zod';

const uuid = z.string().uuid();

/**
 * Discount spec used in both "generate bill" and "update discount" paths.
 *
 * `flat` values are paise. `percent` values are basis points (500 = 5%).
 * A null/absent discount means "no discount" — the service treats a PATCH
 * with `discount: null` as "remove any existing discount".
 */
export const DiscountSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('flat'),
        valuePaise: z.number().int().min(1).max(10_000_000),
        reason: z.string().trim().min(1).max(200),
      })
      .strict(),
    z
      .object({
        type: z.literal('percent'),
        valueBps: z.number().int().min(1).max(10_000),
        reason: z.string().trim().min(1).max(200),
      })
      .strict(),
  ])
  .nullable();
export type DiscountInput = z.infer<typeof DiscountSchema>;

/**
 * Per-line discount override. Keyed by orderItemId so the client doesn't need
 * to know anything about bill_items (which don't exist until the bill is
 * generated). Any orderItemId not in the map gets no line discount. An entry
 * with `discount: null` is a no-op (treated as "no line discount"), so the
 * same shape can be used to clear a previously-set line discount via
 * PATCH /bills/:id/discount.
 */
export const LineDiscountEntrySchema = z
  .object({
    orderItemId: z.string().uuid(),
    discount: DiscountSchema,
  })
  .strict();
export type LineDiscountEntryInput = z.infer<typeof LineDiscountEntrySchema>;

export const LineDiscountsSchema = z.array(LineDiscountEntrySchema).max(200);

export const GenerateBillSchema = z
  .object({
    discount: DiscountSchema.optional().default(null),
    lineDiscounts: LineDiscountsSchema.optional().default([]),
  })
  .strict();
export type GenerateBillInput = z.infer<typeof GenerateBillSchema>;

/**
 * Split bills input. Each entry becomes a first-class bill on the same
 * order. Item-based split only: every billable (non-void) order_item MUST
 * appear in exactly one split. The service rejects:
 *   - orderItemIds not on this order or belonging to void items
 *   - the same orderItemId appearing in two splits
 *   - a billable item missing from every split (would leave unbilled items)
 * Equal-amount or per-head splits are the client's job — compute the
 * grouping first, then call this.
 */
export const SplitBillEntrySchema = z
  .object({
    orderItemIds: z.array(z.string().uuid()).min(1).max(200),
    discount: DiscountSchema.optional().default(null),
    lineDiscounts: LineDiscountsSchema.optional().default([]),
  })
  .strict();
export type SplitBillEntryInput = z.infer<typeof SplitBillEntrySchema>;

export const GenerateSplitBillsSchema = z
  .object({
    // Two or more splits — splitting into one bill is just generateBill.
    splits: z.array(SplitBillEntrySchema).min(2).max(20),
  })
  .strict();
export type GenerateSplitBillsInput = z.infer<typeof GenerateSplitBillsSchema>;

export const UpdateDiscountSchema = z
  .object({
    discount: DiscountSchema,
    // Omitting the field leaves existing line discounts untouched. Passing an
    // empty array clears them all. Passing entries replaces the full set.
    lineDiscounts: LineDiscountsSchema.optional(),
  })
  .strict();
export type UpdateDiscountInput = z.infer<typeof UpdateDiscountSchema>;

export const RecordPaymentSchema = z
  .object({
    method: z.enum(['cash', 'upi', 'card', 'other']),
    amountPaise: z.number().int().min(1).max(1_000_000_000),
    reference: z
      .string()
      .trim()
      .max(120)
      .nullish()
      .transform((v) => (v === undefined || v === '' ? null : v)),
    note: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((v) => (v === undefined || v === '' ? null : v)),
    // Client-generated UUID for idempotent retries. If the same key is sent
    // twice, the second call returns the existing payment instead of creating
    // a duplicate. Required so that network retries and double-taps are safe.
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export type RecordPaymentInput = z.infer<typeof RecordPaymentSchema>;

export const VoidBillSchema = z
  .object({
    reason: z.string().trim().min(1).max(200),
  })
  .strict();
export type VoidBillInput = z.infer<typeof VoidBillSchema>;

/**
 * Used by both "void a single payment" (correction) and "refund a paid bill".
 * Reason is mandatory — these are supervisor actions and the audit trail
 * must explain why money moved.
 */
export const VoidPaymentSchema = z
  .object({
    reason: z.string().trim().min(1).max(200),
  })
  .strict();
export type VoidPaymentInput = z.infer<typeof VoidPaymentSchema>;

export const RefundBillSchema = VoidPaymentSchema;
export type RefundBillInput = VoidPaymentInput;

export const IdParamSchema = z.object({ id: uuid });
export const PaymentIdParamSchema = z.object({
  id: uuid,
  paymentId: uuid,
});
