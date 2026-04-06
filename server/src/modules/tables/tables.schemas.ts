import { z } from 'zod';

/**
 * Input schemas for the tables module.
 *
 * `code` is what staff type on the POS — keep it short, case-insensitive-ish.
 * We normalise to uppercase on input so "t1" and "T1" are the same table.
 */
const code = z
  .string()
  .trim()
  .min(1, 'code required')
  .max(16, 'code too long')
  .transform((c) => c.toUpperCase());

const label = z.string().trim().max(80).nullish().transform((v) => (v === undefined || v === '' ? null : v));
const section = z
  .string()
  .trim()
  .max(40)
  .nullish()
  .transform((v) => (v === undefined || v === '' ? null : v));

const seats = z.number().int().min(1).max(100);

export const CreateTableSchema = z
  .object({
    code,
    label,
    section,
    seats: seats.default(2),
    displayOrder: z.number().int().nonnegative().default(0),
  })
  .strict();
export type CreateTableInput = z.infer<typeof CreateTableSchema>;

export const UpdateTableSchema = z
  .object({
    code: code.optional(),
    label: label.optional(),
    section: section.optional(),
    seats: seats.optional(),
    displayOrder: z.number().int().nonnegative().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field required' });
export type UpdateTableInput = z.infer<typeof UpdateTableSchema>;

/**
 * Bulk-create: the common onboarding path is "make me 20 tables numbered
 * T1..T20". Supporting this in one request is both faster for the operator
 * and lets us wrap the whole thing in a single transaction.
 */
export const BulkCreateTablesSchema = z
  .object({
    tables: z.array(CreateTableSchema).min(1).max(200),
  })
  .strict();
export type BulkCreateTablesInput = z.infer<typeof BulkCreateTablesSchema>;

export const IdParamSchema = z.object({ id: z.string().uuid() });
