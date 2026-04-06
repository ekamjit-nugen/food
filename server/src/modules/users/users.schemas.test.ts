import { describe, it, expect } from 'vitest';
import {
  CreateUserSchema,
  ListUsersQuerySchema,
  ResetPasswordSchema,
  UpdateUserSchema,
} from './users.schemas.js';

describe('CreateUserSchema', () => {
  const valid = {
    email: 'alice@example.com',
    password: 'hunter-two-99',
    fullName: 'Alice',
    role: 'staff' as const,
  };

  it('accepts a well-formed payload', () => {
    const r = CreateUserSchema.parse(valid);
    expect(r.email).toBe('alice@example.com');
    expect(r.role).toBe('staff');
  });

  it('lowercases and trims email', () => {
    const r = CreateUserSchema.parse({ ...valid, email: '  ALICE@Example.com ' });
    expect(r.email).toBe('alice@example.com');
  });

  it('rejects invalid email', () => {
    expect(() => CreateUserSchema.parse({ ...valid, email: 'nope' })).toThrow();
  });

  it('rejects weak password (too short)', () => {
    expect(() => CreateUserSchema.parse({ ...valid, password: 'ab12' })).toThrow();
  });

  it('rejects password with no digit', () => {
    expect(() => CreateUserSchema.parse({ ...valid, password: 'abcdefghij' })).toThrow();
  });

  it('rejects password with no letter', () => {
    expect(() => CreateUserSchema.parse({ ...valid, password: '1234567890' })).toThrow();
  });

  it('rejects unknown role', () => {
    expect(() =>
      CreateUserSchema.parse({ ...valid, role: 'chef' as unknown as 'staff' }),
    ).toThrow();
  });

  it('rejects extra fields (strict)', () => {
    expect(() =>
      CreateUserSchema.parse({ ...valid, outletId: 'abc' } as Record<string, unknown>),
    ).toThrow();
  });
});

describe('UpdateUserSchema', () => {
  it('accepts a single field', () => {
    expect(UpdateUserSchema.parse({ isActive: false }).isActive).toBe(false);
    expect(UpdateUserSchema.parse({ fullName: 'Bob' }).fullName).toBe('Bob');
    expect(UpdateUserSchema.parse({ role: 'manager' }).role).toBe('manager');
  });

  it('rejects empty body', () => {
    expect(() => UpdateUserSchema.parse({})).toThrow();
  });

  it('rejects email updates', () => {
    expect(() =>
      UpdateUserSchema.parse({ email: 'new@example.com' } as Record<string, unknown>),
    ).toThrow();
  });

  it('rejects password updates (must go through reset endpoint)', () => {
    expect(() =>
      UpdateUserSchema.parse({ password: 'hunter-two-99' } as Record<string, unknown>),
    ).toThrow();
  });

  it('trims fullName', () => {
    expect(UpdateUserSchema.parse({ fullName: '  Bob  ' }).fullName).toBe('Bob');
  });
});

describe('ResetPasswordSchema', () => {
  it('accepts a valid password', () => {
    const r = ResetPasswordSchema.parse({ newPassword: 'correct-horse-9' });
    expect(r.newPassword).toBe('correct-horse-9');
  });

  it('rejects short password', () => {
    expect(() => ResetPasswordSchema.parse({ newPassword: 'short1' })).toThrow();
  });

  it('rejects missing field', () => {
    expect(() => ResetPasswordSchema.parse({})).toThrow();
  });
});

describe('ListUsersQuerySchema', () => {
  it('accepts empty query', () => {
    const r = ListUsersQuerySchema.parse({});
    expect(r.role).toBeUndefined();
    expect(r.includeInactive).toBe(false);
  });

  it('transforms includeInactive=true string to boolean', () => {
    expect(ListUsersQuerySchema.parse({ includeInactive: 'true' }).includeInactive).toBe(true);
    expect(ListUsersQuerySchema.parse({ includeInactive: 'false' }).includeInactive).toBe(false);
  });

  it('accepts role filter', () => {
    expect(ListUsersQuerySchema.parse({ role: 'kitchen' }).role).toBe('kitchen');
  });

  it('rejects unknown role', () => {
    expect(() => ListUsersQuerySchema.parse({ role: 'waiter' })).toThrow();
  });
});
