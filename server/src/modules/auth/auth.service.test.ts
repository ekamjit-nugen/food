/**
 * Unit tests for pure-function pieces of the auth service.
 *
 * These intentionally avoid hitting the DB. Env defaults come from
 * src/test/setup.ts (wired via vitest.config.ts) so they are set BEFORE
 * module imports are evaluated.
 */
import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { hashPassword, verifyPassword, signToken } from './auth.service.js';
import { env } from '../../config/env.js';

describe('auth.service (pure)', () => {
  describe('hashPassword + verifyPassword', () => {
    it('round-trips a correct password', async () => {
      const hash = await hashPassword('correcthorse7');
      expect(await verifyPassword('correcthorse7', hash)).toBe(true);
    });

    it('rejects a wrong password', async () => {
      const hash = await hashPassword('correcthorse7');
      expect(await verifyPassword('wrong', hash)).toBe(false);
    });

    it('returns false for a malformed hash instead of throwing', async () => {
      expect(await verifyPassword('whatever', 'not-a-bcrypt-hash')).toBe(false);
    });

    it('produces distinct hashes for the same password (salted)', async () => {
      const a = await hashPassword('correcthorse7');
      const b = await hashPassword('correcthorse7');
      expect(a).not.toBe(b);
    });
  });

  describe('signToken', () => {
    it('returns a verifiable JWT with the expected claims', () => {
      const { token } = signToken({
        sub: 'user-123',
        tenantId: 'tenant-789',
        outletId: 'outlet-456',
        isTenantOwner: true,
        email: 'a@b.com',
        role: 'admin',
      });
      const decoded = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
      expect(decoded.sub).toBe('user-123');
      expect(decoded.tenantId).toBe('tenant-789');
      expect(decoded.outletId).toBe('outlet-456');
      expect(decoded.isTenantOwner).toBe(true);
      expect(decoded.email).toBe('a@b.com');
      expect(decoded.role).toBe('admin');
      expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('does not include a password or hash in the payload', () => {
      const { token } = signToken({
        sub: 'u',
        tenantId: 't',
        outletId: 'o',
        isTenantOwner: false,
        email: 'a@b.com',
        role: 'staff',
      });
      const decoded = jwt.decode(token) as Record<string, unknown>;
      expect(Object.keys(decoded)).not.toContain('password');
      expect(Object.keys(decoded)).not.toContain('passwordHash');
    });
  });
});
