import { z } from 'zod';

/**
 * Report query schemas.
 *
 * Date handling (v1): `from` and `to` are ISO 8601 date or datetime strings.
 * If only `from` is provided, `to` defaults to now. If only `to`, `from`
 * defaults to the epoch (cheap bound, caller should send both). Both are
 * interpreted as ABSOLUTE instants — no outlet-timezone rewriting in v1.
 * Document this: the friend's POS should pick range boundaries in local TZ
 * and send ISO strings.
 */
const dateish = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'invalid ISO date')
  .transform((s) => new Date(s));

/**
 * Scope controls whether a report aggregates a single outlet (current header
 * outlet) or every outlet the caller can see inside their tenant. Owners
 * (isTenantOwner) see every active outlet in the tenant; scoped staff see
 * the intersection with user_outlet_access.
 *
 * We keep the field `.optional()` (rather than `.default('outlet')`) because
 * the project's `validate()` helper types the schema as `ZodSchema<T>` which
 * requires input T === output T; `.default()` produces different input vs
 * output types. The controller normalises undefined → 'outlet' before
 * handing off to the service.
 */
const scope = z.enum(['outlet', 'tenant']).optional();

export const DateRangeSchema = z
  .object({
    from: dateish.optional(),
    to: dateish.optional(),
    scope,
  })
  .strict()
  .refine(
    (v) => !(v.from && v.to) || v.from <= v.to,
    { message: '`from` must be on or before `to`' },
  );
export type DateRangeInput = z.infer<typeof DateRangeSchema>;

export const OrderMasterQuerySchema = z
  .object({
    from: dateish.optional(),
    to: dateish.optional(),
    status: z.enum(['open', 'closed', 'cancelled']).optional(),
    orderType: z.enum(['dine_in', 'takeaway']).optional(),
    format: z.enum(['json', 'csv']).default('json'),
    scope,
  })
  .strict()
  .refine(
    (v) => !(v.from && v.to) || v.from <= v.to,
    { message: '`from` must be on or before `to`' },
  );
export type OrderMasterQueryInput = z.infer<typeof OrderMasterQuerySchema>;
