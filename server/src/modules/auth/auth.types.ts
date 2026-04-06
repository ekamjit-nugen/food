import type { AuthContext } from '../../middleware/auth.js';

/**
 * Shape of the JWT payload we sign. Matches what requireAuth reads.
 * Keep this in sync with middleware/auth.ts — a mismatch is a silent
 * security bug (tokens accepted with the wrong role, etc.).
 */
export interface TokenPayload {
  sub: string; // user id
  tenantId: string;
  outletId: string;
  isTenantOwner: boolean;
  email: string;
  role: AuthContext['role'];
}

export interface PublicUser {
  id: string;
  tenantId: string;
  outletId: string;
  isTenantOwner: boolean;
  email: string;
  fullName: string;
  role: AuthContext['role'];
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface LoginResult {
  token: string;
  expiresIn: string;
  user: PublicUser;
  refreshToken: string;
}
