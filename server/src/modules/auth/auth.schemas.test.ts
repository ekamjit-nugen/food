import { describe, it, expect } from 'vitest';
import { LoginSchema, ChangePasswordSchema, PasswordSchema } from './auth.schemas.js';

describe('auth.schemas', () => {
  describe('LoginSchema', () => {
    it('lowercases and trims the email', () => {
      const r = LoginSchema.parse({
        tenantSlug: 'acme',
        email: '  Foo@Example.COM  ',
        password: 'whatever',
      });
      expect(r.email).toBe('foo@example.com');
    });

    it('rejects a malformed email', () => {
      expect(() =>
        LoginSchema.parse({ tenantSlug: 'acme', email: 'not-an-email', password: 'x' }),
      ).toThrow();
    });

    it('rejects a missing tenant slug', () => {
      expect(() =>
        LoginSchema.parse({ email: 'a@b.com', password: 'x' } as Record<string, unknown>),
      ).toThrow();
    });

    it('rejects an invalid tenant slug', () => {
      expect(() =>
        LoginSchema.parse({ tenantSlug: '-bad-', email: 'a@b.com', password: 'x' }),
      ).toThrow();
    });

    it('rejects unknown fields', () => {
      expect(() =>
        LoginSchema.parse({ tenantSlug: 'acme', email: 'a@b.com', password: 'x', extra: true }),
      ).toThrow();
    });
  });

  describe('PasswordSchema', () => {
    it('rejects short passwords', () => {
      expect(() => PasswordSchema.parse('Short1')).toThrow();
    });

    it('rejects letters-only', () => {
      expect(() => PasswordSchema.parse('onlyletters')).toThrow();
    });

    it('rejects digits-only', () => {
      expect(() => PasswordSchema.parse('1234567890')).toThrow();
    });

    it('accepts a valid password', () => {
      expect(() => PasswordSchema.parse('correcthorse7')).not.toThrow();
    });

    it('rejects absurdly long input', () => {
      expect(() => PasswordSchema.parse('a1'.repeat(100))).toThrow();
    });
  });

  describe('ChangePasswordSchema', () => {
    it('rejects when new password equals current', () => {
      expect(() =>
        ChangePasswordSchema.parse({
          currentPassword: 'correcthorse7',
          newPassword: 'correcthorse7',
        }),
      ).toThrow();
    });

    it('accepts a valid change', () => {
      expect(() =>
        ChangePasswordSchema.parse({
          currentPassword: 'old-one-1',
          newPassword: 'newhorse42',
        }),
      ).not.toThrow();
    });
  });
});
