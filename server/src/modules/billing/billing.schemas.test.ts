import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  DiscountSchema,
  GenerateBillSchema,
  RecordPaymentSchema,
  UpdateDiscountSchema,
  VoidBillSchema,
} from './billing.schemas.js';

describe('DiscountSchema', () => {
  it('accepts a flat discount in paise', () => {
    const r = DiscountSchema.parse({ type: 'flat', valuePaise: 5000, reason: 'loyal' });
    expect(r?.type).toBe('flat');
  });

  it('accepts a percent discount in bps', () => {
    const r = DiscountSchema.parse({ type: 'percent', valueBps: 1000, reason: '10% off' });
    expect(r?.type).toBe('percent');
  });

  it('accepts null (no discount)', () => {
    expect(DiscountSchema.parse(null)).toBeNull();
  });

  it('rejects zero-valued discount (flat)', () => {
    expect(() =>
      DiscountSchema.parse({ type: 'flat', valuePaise: 0, reason: 'x' }),
    ).toThrow();
  });

  it('rejects percent > 100% (bps > 10000)', () => {
    expect(() =>
      DiscountSchema.parse({ type: 'percent', valueBps: 10_001, reason: 'x' }),
    ).toThrow();
  });

  it('requires a reason', () => {
    expect(() =>
      DiscountSchema.parse({ type: 'flat', valuePaise: 100, reason: '' }),
    ).toThrow();
  });

  it('rejects unknown type', () => {
    expect(() =>
      DiscountSchema.parse({ type: 'bogo', valuePaise: 100, reason: 'x' }),
    ).toThrow();
  });
});

describe('GenerateBillSchema', () => {
  it('defaults to no discount', () => {
    const r = GenerateBillSchema.parse({});
    expect(r.discount).toBeNull();
  });

  it('accepts a discount', () => {
    const r = GenerateBillSchema.parse({
      discount: { type: 'flat', valuePaise: 1000, reason: 'x' },
    });
    expect(r.discount?.type).toBe('flat');
  });
});

describe('UpdateDiscountSchema', () => {
  it('requires the discount field (use null to clear)', () => {
    expect(() => UpdateDiscountSchema.parse({})).toThrow();
  });

  it('accepts null to clear', () => {
    const r = UpdateDiscountSchema.parse({ discount: null });
    expect(r.discount).toBeNull();
  });
});

describe('RecordPaymentSchema', () => {
  const key = randomUUID();

  it('accepts a minimal cash payment', () => {
    const r = RecordPaymentSchema.parse({ method: 'cash', amountPaise: 50000, idempotencyKey: key });
    expect(r.method).toBe('cash');
    expect(r.reference).toBeNull();
    expect(r.note).toBeNull();
    expect(r.idempotencyKey).toBe(key);
  });

  it('rejects zero or negative amount', () => {
    expect(() => RecordPaymentSchema.parse({ method: 'cash', amountPaise: 0, idempotencyKey: key })).toThrow();
    expect(() =>
      RecordPaymentSchema.parse({ method: 'cash', amountPaise: -1, idempotencyKey: key }),
    ).toThrow();
  });

  it('rejects non-integer amount', () => {
    expect(() =>
      RecordPaymentSchema.parse({ method: 'upi', amountPaise: 100.5, idempotencyKey: key }),
    ).toThrow();
  });

  it('accepts UPI with reference', () => {
    const r = RecordPaymentSchema.parse({
      method: 'upi',
      amountPaise: 26300,
      reference: 'UPI/123456789',
      idempotencyKey: key,
    });
    expect(r.reference).toBe('UPI/123456789');
  });

  it('rejects unknown method', () => {
    expect(() =>
      RecordPaymentSchema.parse({ method: 'crypto', amountPaise: 1000, idempotencyKey: key }),
    ).toThrow();
  });

  it('rejects unknown fields (strict)', () => {
    expect(() =>
      RecordPaymentSchema.parse({ method: 'cash', amountPaise: 1000, tip: 500, idempotencyKey: key }),
    ).toThrow();
  });

  it('rejects missing idempotencyKey', () => {
    expect(() =>
      RecordPaymentSchema.parse({ method: 'cash', amountPaise: 1000 }),
    ).toThrow();
  });

  it('rejects non-UUID idempotencyKey', () => {
    expect(() =>
      RecordPaymentSchema.parse({ method: 'cash', amountPaise: 1000, idempotencyKey: 'not-a-uuid' }),
    ).toThrow();
  });
});

describe('VoidBillSchema', () => {
  it('requires a non-empty reason', () => {
    expect(() => VoidBillSchema.parse({ reason: '' })).toThrow();
  });

  it('trims the reason', () => {
    const r = VoidBillSchema.parse({ reason: '  wrong table  ' });
    expect(r.reason).toBe('wrong table');
  });
});
