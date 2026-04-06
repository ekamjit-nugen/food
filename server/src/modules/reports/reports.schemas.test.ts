import { describe, it, expect } from 'vitest';
import { DateRangeSchema, OrderMasterQuerySchema } from './reports.schemas.js';

describe('DateRangeSchema', () => {
  it('accepts empty query', () => {
    const r = DateRangeSchema.parse({});
    expect(r.from).toBeUndefined();
    expect(r.to).toBeUndefined();
  });

  it('parses ISO dates into Date instances', () => {
    const r = DateRangeSchema.parse({ from: '2026-04-01', to: '2026-04-05' });
    expect(r.from).toBeInstanceOf(Date);
    expect(r.to).toBeInstanceOf(Date);
  });

  it('rejects invalid dates', () => {
    expect(() => DateRangeSchema.parse({ from: 'not-a-date' })).toThrow();
  });

  it('rejects from > to', () => {
    expect(() =>
      DateRangeSchema.parse({ from: '2026-04-10', to: '2026-04-01' }),
    ).toThrow();
  });

  it('rejects unknown fields', () => {
    expect(() => DateRangeSchema.parse({ foo: 'bar' })).toThrow();
  });
});

describe('OrderMasterQuerySchema', () => {
  it('defaults format to json', () => {
    const r = OrderMasterQuerySchema.parse({});
    expect(r.format).toBe('json');
  });

  it('accepts csv format', () => {
    const r = OrderMasterQuerySchema.parse({ format: 'csv' });
    expect(r.format).toBe('csv');
  });

  it('accepts status and orderType filters', () => {
    const r = OrderMasterQuerySchema.parse({
      status: 'closed',
      orderType: 'dine_in',
    });
    expect(r.status).toBe('closed');
    expect(r.orderType).toBe('dine_in');
  });

  it('rejects unknown status', () => {
    expect(() => OrderMasterQuerySchema.parse({ status: 'refunded' })).toThrow();
  });

  it('rejects unknown format', () => {
    expect(() => OrderMasterQuerySchema.parse({ format: 'xml' })).toThrow();
  });
});
