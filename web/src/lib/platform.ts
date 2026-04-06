import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/**
 * Platform super-admin client. Mutually exclusive with the tenant auth in
 * ./auth.tsx — different token storage key, different JWT audience, different
 * backend routes. A platform admin who wants to also act inside a specific
 * tenant has to log in twice; that is intentional and matches the server-side
 * separation.
 */

export type TenantStatus = 'trial' | 'active' | 'suspended' | 'cancelled';

export interface PlatformUser {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PlatformTenantSummary {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  plan: string | null;
  createdAt: string;
  outletCount: number;
  userCount: number;
  paidBillCount: number;
  lifetimeRevenuePaise: number;
  ownerEmail: string | null;
  lastBillAt: string | null;
}

export interface PlatformStats {
  tenantCount: number;
  byStatus: Record<TenantStatus, number>;
  lifetimeRevenuePaise: number;
  activeLast7Days: number;
  activeLast30Days: number;
}

export interface PlatformTenantOutlet {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
}

export interface PlatformTenantUser {
  id: string;
  email: string;
  fullName: string;
  role: 'admin' | 'manager' | 'staff' | 'kitchen';
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface PlatformTenantDetail extends PlatformTenantSummary {
  outlets: PlatformTenantOutlet[];
  recentUsers: PlatformTenantUser[];
}

const PLATFORM_TOKEN_KEY = 'food.platform.token';

export function readPlatformToken(): string | null {
  try {
    return localStorage.getItem(PLATFORM_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writePlatformToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(PLATFORM_TOKEN_KEY, token);
    else localStorage.removeItem(PLATFORM_TOKEN_KEY);
  } catch {
    // private mode — session still works for this tab
  }
}

export async function platformLogin(
  email: string,
  password: string,
): Promise<{ token: string; user: PlatformUser }> {
  const result = await api.post<{ token: string; expiresIn: string; user: PlatformUser }>(
    '/platform/auth/login',
    { email, password },
  );
  writePlatformToken(result.token);
  return { token: result.token, user: result.user };
}

export function platformLogout(): void {
  writePlatformToken(null);
}

// ---------------------------------------------------------------------------
// React Query hooks
// ---------------------------------------------------------------------------

const keys = {
  me: ['platform', 'me'] as const,
  stats: ['platform', 'stats'] as const,
  tenants: ['platform', 'tenants'] as const,
  tenant: (id: string) => ['platform', 'tenant', id] as const,
};

export function usePlatformStats() {
  return useQuery({
    queryKey: keys.stats,
    queryFn: () => api.get<PlatformStats>('/platform/stats'),
    staleTime: 30 * 1000,
  });
}

export function usePlatformMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api.get<PlatformUser>('/platform/auth/me'),
    // Only try if we have a token; otherwise return null-ish via enabled.
    enabled: !!readPlatformToken(),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useTenants() {
  return useQuery({
    queryKey: keys.tenants,
    queryFn: () => api.get<{ data: PlatformTenantSummary[] }>('/platform/tenants').then((r) => r.data),
    staleTime: 30 * 1000,
  });
}

export function useTenant(id: string | undefined) {
  return useQuery({
    queryKey: id ? keys.tenant(id) : ['platform', 'tenant', 'disabled'],
    queryFn: () => api.get<PlatformTenantDetail>(`/platform/tenants/${id!}`),
    enabled: !!id,
    staleTime: 15 * 1000,
  });
}

export function useUpdateTenantStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TenantStatus }) =>
      api.patch<PlatformTenantSummary>(`/platform/tenants/${id}/status`, { status }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: keys.tenants });
      void qc.invalidateQueries({ queryKey: keys.tenant(vars.id) });
      void qc.invalidateQueries({ queryKey: keys.stats });
    },
  });
}
