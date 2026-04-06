import { z } from 'zod';
import { PasswordSchema } from '../auth/auth.schemas.js';

/**
 * User management schemas.
 *
 * Roles, emails, and passwords reuse the same definitions the auth module
 * uses. That's intentional — the auth module is the source of truth for
 * "what a valid user looks like" and users CRUD is just the admin-facing
 * surface on top of it.
 *
 * Kitchen role: kitchen users can log in, see KDS, and move KOTs through
 * states. They cannot take orders or touch billing. Shop floor reality:
 * kitchen staff usually share one tablet with a shared login, but we model
 * them as first-class users anyway so the audit log stays meaningful.
 */

const RoleSchema = z.enum(['admin', 'manager', 'staff', 'kitchen']);

const EmailSchema = z.string().trim().toLowerCase().email().max(254);

const FullNameSchema = z.string().trim().min(1).max(120);

export const CreateUserSchema = z
  .object({
    email: EmailSchema,
    password: PasswordSchema,
    fullName: FullNameSchema,
    role: RoleSchema,
  })
  .strict();
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

/**
 * Update surface is deliberately narrow. Email is NOT editable in v1 — it is
 * the login identifier and changing it opens a phishing vector (an ex-employee
 * with cached credentials suddenly "logs in as" someone else). If someone
 * really needs a new email, deactivate the old user and create a new one.
 *
 * At least one field must be provided; an empty body is almost always a bug.
 */
export const UpdateUserSchema = z
  .object({
    fullName: FullNameSchema.optional(),
    role: RoleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => v.fullName !== undefined || v.role !== undefined || v.isActive !== undefined,
    { message: 'at least one field must be provided' },
  );
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

/**
 * Admin resets another user's password. No "current password" required —
 * this is the "I forgot my password, ping the admin" path. The admin is
 * explicitly trusted, and the audit log captures who did it.
 */
export const ResetPasswordSchema = z
  .object({
    newPassword: PasswordSchema,
  })
  .strict();
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export const ListUsersQuerySchema = z
  .object({
    role: RoleSchema.optional(),
    includeInactive: z
      .string()
      .optional()
      .transform((v) => v === 'true'),
  })
  .strict();
export type ListUsersQueryInput = z.infer<typeof ListUsersQuerySchema>;

export const IdParamSchema = z.object({ id: z.string().uuid() });
