/**
 * Platform super-admin types.
 *
 * The platform pool is deliberately separate from the tenant pool. A
 * platform user is not a tenant user: they do not belong to any tenant,
 * they can see all tenants, and their tokens carry a different audience
 * claim ('platform') so that a tenant JWT can never be mistaken for a
 * platform JWT (and vice versa). This split is cheap to enforce and
 * prevents a whole class of privilege-escalation bugs where a customer
 * token accidentally reaches a /platform route.
 */

export interface PlatformUser {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface PlatformUserWithSecret extends PlatformUser {
  passwordHash: string;
}

export interface PlatformTokenPayload {
  sub: string; // platform user id
  email: string;
}

export interface PlatformAuthContext {
  userId: string;
  email: string;
}

export interface PlatformLoginResult {
  token: string;
  expiresIn: string;
  user: PlatformUser;
}

/**
 * Tenant status as stored in the DB enum `tenant_status`.
 * See schema.sql: `CREATE TYPE tenant_status AS ENUM ('trial', 'active', 'suspended', 'cancelled');`
 *
 * Tenant login currently gates on `status = 'active'` — suspending or
 * cancelling a tenant from the platform console immediately blocks all
 * logins for that tenant's staff and owner without touching any user rows.
 */
export type TenantStatus = 'trial' | 'active' | 'suspended' | 'cancelled';

/**
 * Tenant summary row used by the platform tenant list view. The rollup
 * stats (outlets, users, bills, lifetime revenue) are computed in a single
 * aggregation query; they're "lifetime" for v1 because the console is a
 * health-check surface, not a billing dashboard.
 */
export interface PlatformTenantSummary {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: string | null;
  createdAt: Date;
  outletCount: number;
  userCount: number;
  paidBillCount: number;
  lifetimeRevenuePaise: number;
  ownerEmail: string | null;
  // Timestamp of the most recent paid bill for this tenant, or null if the
  // tenant has never taken a payment. This is the "is this tenant alive?"
  // signal the platform operator actually looks at — created_at tells you
  // nothing once a tenant has been around for a few weeks.
  lastBillAt: Date | null;
}

/**
 * Platform-wide rollup for the console header strip. Cheap to compute
 * because the tenant count is small (tens, not thousands) and the bills
 * aggregation is a single indexed scan.
 */
export interface PlatformStats {
  tenantCount: number;
  byStatus: Record<TenantStatus, number>;
  lifetimeRevenuePaise: number;
  activeLast7Days: number;
  activeLast30Days: number;
}

/**
 * Detailed tenant view — summary + outlets + recent sign-in activity.
 * Deliberately minimal: this is a "is tenant X healthy?" screen, not a
 * full-fledged support tool.
 */
export interface PlatformTenantDetail extends PlatformTenantSummary {
  outlets: Array<{
    id: string;
    name: string;
    isActive: boolean;
    createdAt: Date;
  }>;
  recentUsers: Array<{
    id: string;
    email: string;
    fullName: string;
    role: 'admin' | 'manager' | 'staff' | 'kitchen';
    isActive: boolean;
    lastLoginAt: Date | null;
  }>;
}
