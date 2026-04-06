import { describe, it, expect } from 'vitest';
import {
  BulkCreateTablesSchema,
  CreateTableSchema,
  IdParamSchema,
  UpdateTableSchema,
} from './tables.schemas.js';

describe('CreateTableSchema', () => {
  it('uppercases and trims code', () => {
    const r = CreateTableSchema.parse({ code: '  t1 ' });
    expect(r.code).toBe('T1');
  });

  it('applies defaults for seats and displayOrder', () => {
    const r = CreateTableSchema.parse({ code: 'T1' });
    expect(r.seats).toBe(2);
    expect(r.displayOrder).toBe(0);
  });

  it('coerces empty-string label and section to null', () => {
    const r = CreateTableSchema.parse({ code: 'T1', label: '', section: '' });
    expect(r.label).toBeNull();
    expect(r.section).toBeNull();
  });

  it('rejects empty code', () => {
    expect(() => CreateTableSchema.parse({ code: '' })).toThrow();
  });

  it('rejects code longer than 16 chars', () => {
    expect(() => CreateTableSchema.parse({ code: 'X'.repeat(17) })).toThrow();
  });

  it('rejects seats below 1 and above 100', () => {
    expect(() => CreateTableSchema.parse({ code: 'T1', seats: 0 })).toThrow();
    expect(() => CreateTableSchema.parse({ code: 'T1', seats: 101 })).toThrow();
  });

  it('rejects non-integer seats', () => {
    expect(() => CreateTableSchema.parse({ code: 'T1', seats: 2.5 })).toThrow();
  });

  it('rejects negative displayOrder', () => {
    expect(() => CreateTableSchema.parse({ code: 'T1', displayOrder: -1 })).toThrow();
  });

  it('rejects unknown fields (strict mode)', () => {
    expect(() => CreateTableSchema.parse({ code: 'T1', foo: 'bar' })).toThrow();
  });
});

describe('UpdateTableSchema', () => {
  it('requires at least one field', () => {
    expect(() => UpdateTableSchema.parse({})).toThrow();
  });

  it('accepts a single isActive=false (deactivation path)', () => {
    const r = UpdateTableSchema.parse({ isActive: false });
    expect(r.isActive).toBe(false);
  });

  it('uppercases code on update', () => {
    const r = UpdateTableSchema.parse({ code: 't42' });
    expect(r.code).toBe('T42');
  });

  it('rejects unknown fields', () => {
    expect(() => UpdateTableSchema.parse({ foo: 'bar' })).toThrow();
  });
});

describe('BulkCreateTablesSchema', () => {
  it('accepts 1..200 tables', () => {
    const mk = (n: number) =>
      BulkCreateTablesSchema.parse({
        tables: Array.from({ length: n }, (_, i) => ({ code: `T${i + 1}` })),
      });
    expect(mk(1).tables).toHaveLength(1);
    expect(mk(200).tables).toHaveLength(200);
  });

  it('rejects empty array', () => {
    expect(() => BulkCreateTablesSchema.parse({ tables: [] })).toThrow();
  });

  it('rejects more than 200 tables', () => {
    expect(() =>
      BulkCreateTablesSchema.parse({
        tables: Array.from({ length: 201 }, (_, i) => ({ code: `T${i}` })),
      }),
    ).toThrow();
  });

  it('propagates child schema normalisation (uppercase codes)', () => {
    const r = BulkCreateTablesSchema.parse({
      tables: [{ code: 't1' }, { code: 't2' }],
    });
    expect(r.tables.map((t) => t.code)).toEqual(['T1', 'T2']);
  });
});

describe('IdParamSchema', () => {
  it('accepts a uuid', () => {
    IdParamSchema.parse({ id: '11111111-1111-1111-1111-111111111111' });
  });

  it('rejects a non-uuid', () => {
    expect(() => IdParamSchema.parse({ id: 'not-a-uuid' })).toThrow();
  });
});
