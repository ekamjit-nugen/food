import { api } from './api';

/**
 * Device pairing API client. These two endpoints are anonymous — the
 * pairing code / device token IS the authorization. The tenant JWT
 * flow lives in auth.tsx.
 */

export interface PairedDevice {
  id: string;
  tenantId: string;
  userId: string;
  outletId: string;
  label: string;
  platform: 'ios' | 'android' | null;
  lastSeenAt: string | null;
  lastIp: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  createdAt: string;
}

export interface ConsumePairingResult {
  deviceToken: string;
  device: PairedDevice;
}

export interface PublicUser {
  id: string;
  tenantId: string;
  outletId: string;
  isTenantOwner: boolean;
  email: string;
  fullName: string;
  role: 'owner' | 'admin' | 'manager' | 'staff';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface DeviceLoginResult {
  token: string;
  expiresIn: string;
  user: PublicUser;
}

export async function consumePairing(input: {
  code: string;
  label: string;
  platform?: 'ios' | 'android';
}): Promise<ConsumePairingResult> {
  return api.post<ConsumePairingResult>('/auth/pair', input, { auth: false });
}

export async function deviceLogin(deviceToken: string): Promise<DeviceLoginResult> {
  return api.post<DeviceLoginResult>('/auth/device-login', { deviceToken }, { auth: false });
}
