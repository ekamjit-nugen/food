import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Role } from './auth';

/**
 * Staff management hooks.
 *
 * Two surfaces combined in one file because they share data boundaries:
 *   - /users        — list existing staff (admin + manager can read)
 *   - /auth/invite  — create a pending invite (admin only in practice,
 *                     enforced server-side; UI gates on role)
 *
 * The invite endpoint returns `{ token, expiresAt }` in dev and just
 * `{ expiresAt }` in production. The admin UI uses the token to construct
 * a shareable accept-invite URL for the invitee (WhatsApp / in person) —
 * when the email worker ships this can disappear and the response will
 * just confirm "invite sent".
 */

export interface StaffUser {
  id: string;
  tenantId: string;
  outletId: string;
  isTenantOwner: boolean;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export const staffKeys = {
  list: ['users'] as const,
};

export function useStaff() {
  return useQuery({
    queryKey: staffKeys.list,
    queryFn: async () => {
      const res = await api.get<{ data: StaffUser[] }>('/users', {
        includeInactive: true,
      });
      return res.data;
    },
  });
}

export interface InviteInput {
  email: string;
  fullName?: string;
  role: 'manager' | 'staff' | 'kitchen';
  outletIds: string[];
}

export interface InviteResult {
  // token is present in dev mode only; production strips it so the email
  // worker is the single delivery channel.
  token?: string;
  expiresAt: string;
}

export function useToggleUserActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { userId: string; isActive: boolean }) =>
      api.patch<StaffUser>(`/users/${vars.userId}`, { isActive: vars.isActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: staffKeys.list });
    },
  });
}

export function useInviteStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteInput) => api.post<InviteResult>('/auth/invite', input),
    onSuccess: () => {
      // The invitee is not a user yet — no staff list change until they
      // accept. But queries that read tenant state may still want to
      // refetch. Keep this conservative for now.
      qc.invalidateQueries({ queryKey: staffKeys.list });
    },
  });
}
