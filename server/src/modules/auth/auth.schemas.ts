import { z } from 'zod';

/**
 * Password policy for v1.
 *
 *   - Minimum 10 characters. NIST 800-63B now recommends length over
 *     character-class rules; 10 is a reasonable floor for a staff-only
 *     tool.
 *   - Must contain at least one letter and one digit. Not because it
 *     meaningfully adds entropy, but because it catches the worst cases
 *     ("passwordpassword") without annoying legitimate users.
 *   - Max 128 to prevent DoS via bcrypt on absurdly long inputs.
 *
 * We deliberately do NOT enforce symbols or mixed case. That's cargo-cult
 * and pushes users toward predictable substitutions ("Password1!").
 */
export const PasswordSchema = z
  .string()
  .min(10, 'password must be at least 10 characters')
  .max(128, 'password too long')
  .refine((p) => /[a-zA-Z]/.test(p), 'password must contain a letter')
  .refine((p) => /[0-9]/.test(p), 'password must contain a digit');

/**
 * Tenant slug: lowercase kebab-case, 2–40 chars, starts and ends with
 * alphanumeric. Matches the CHECK constraint on tenants.slug in schema.sql.
 */
export const TenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'invalid tenant slug');

export const LoginSchema = z
  .object({
    tenantSlug: TenantSlugSchema,
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1).max(128),
  })
  .strict();
export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * Self-serve tenant signup. Creates a new tenant, its first outlet, and a
 * tenant-owner user in one transaction.
 *
 *   - restaurantName is the tenant's display name ("Acme Restaurants").
 *   - slug is the URL identifier ("acme") — unique across the platform,
 *     lowercase kebab-case, matches the CHECK on tenants.slug.
 *   - firstOutletName is required because a tenant with zero outlets is
 *     unusable; we set it up front rather than shipping an onboarding step
 *     that can be abandoned.
 *   - Email is lowercased and trimmed on parse so lookups are stable.
 */
export const SignupSchema = z
  .object({
    restaurantName: z.string().trim().min(2).max(120),
    slug: TenantSlugSchema,
    firstOutletName: z.string().trim().min(1).max(120),
    ownerFullName: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    password: PasswordSchema,
  })
  .strict();
export type SignupInput = z.infer<typeof SignupSchema>;

/**
 * Staff invite. A tenant owner or manager invites a user by email, choosing
 * a role and which outlets the invitee should have access to. The tenant is
 * always the actor's tenant (enforced in the service, not the schema).
 *
 * Roles: only non-owner roles are invitable — owner creation goes through
 * signup (or platform admin tooling), never invite. The CHECK on
 * staff_invites.role in the DB enforces this too.
 */
export const InviteStaffSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    fullName: z.string().trim().min(1).max(120).optional(),
    role: z.enum(['manager', 'staff', 'kitchen']),
    outletIds: z.array(z.string().uuid()).min(1).max(50),
  })
  .strict();
export type InviteStaffInput = z.infer<typeof InviteStaffSchema>;

export const AcceptInviteSchema = z
  .object({
    token: z.string().min(16).max(256),
    fullName: z.string().trim().min(1).max(120).optional(),
    password: PasswordSchema,
  })
  .strict();
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>;

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: PasswordSchema,
  })
  .strict()
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'new password must differ from current',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
