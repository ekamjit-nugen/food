import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

/**
 * Paired-device hooks for the admin console.
 *
 * Three surfaces:
 *   - POST /users/:id/pairing-codes  → issue a one-time code shown as a QR.
 *     The raw code is returned ONCE and must not be cached.
 *   - GET  /users/:id/devices        → list active + revoked devices.
 *   - DELETE /users/:id/devices/:dId → revoke a single device.
 *
 * The device token itself never reaches the browser — only the admin-side
 * pairing code + device metadata. The mobile app sees the token exactly
 * once, at /auth/pair, and stores it in device-secure storage.
 */

export interface UserDevice {
  id: string;
  tenantId: string;
  userId: string;
  outletId: string;
  label: string;
  platform: 'ios' | 'android' | string | null;
  lastSeenAt: string | null;
  lastIp: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
}

export interface PairingCodeIssued {
  /** 8-char alphanumeric code. Returned once, never logged. */
  code: string;
  /** JSON payload the mobile QR scanner parses. */
  qrPayload: string;
  expiresAt: string;
}

export const deviceKeys = {
  list: (userId: string) => ['devices', userId] as const,
};

export function useUserDevices(userId: string | null) {
  return useQuery({
    queryKey: deviceKeys.list(userId ?? ''),
    enabled: userId != null,
    queryFn: async () => {
      const res = await api.get<{ data: UserDevice[] }>(`/users/${userId}/devices`);
      return res.data;
    },
  });
}

export function useCreatePairingCode(userId: string) {
  return useMutation({
    mutationFn: () =>
      api.post<PairingCodeIssued>(`/users/${userId}/pairing-codes`, {}),
  });
}

export function useRevokeDevice(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) =>
      api.del<UserDevice>(`/users/${userId}/devices/${deviceId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: deviceKeys.list(userId) });
    },
  });
}
