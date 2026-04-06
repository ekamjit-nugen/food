import { z } from 'zod';

/**
 * Zod schemas for service alert endpoints.
 *
 * CreateAlertSchema — any authenticated user can raise an alert. Kind is
 * required; tableId and note are optional. Note is capped at 200 chars to
 * keep alerts glanceable — anything longer is a conversation, which is not
 * what this system is for.
 */
export const CreateAlertSchema = z
  .object({
    kind: z.enum(['call_waiter', 'call_kitchen', 'call_manager']),
    tableId: z.string().uuid().optional(),
    note: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export type CreateAlertInput = z.infer<typeof CreateAlertSchema>;

export const ListAlertsQuerySchema = z
  .object({
    // `active=true` returns only unacked alerts. This is the default the
    // mobile app and KDS will use; pass `active=false` to see the full
    // audit history for a shift review.
    active: z
      .string()
      .optional()
      .transform((v) => v !== 'false'),
  })
  .strict();
export type ListAlertsQueryInput = z.infer<typeof ListAlertsQuerySchema>;

export const AlertIdParamSchema = z.object({ id: z.string().uuid() });
