import { describe, it, expect } from 'vitest';
import {
  AddOrderItemsSchema,
  CancelOrderSchema,
  CreateOrderSchema,
  DraftOrderItemSchema,
  UpdateKotStatusSchema,
  VoidOrderItemSchema,
} from './orders.schemas.js';

const UUID = '11111111-1111-1111-1111-111111111111';
const UUID2 = '22222222-2222-2222-2222-222222222222';

describe('DraftOrderItemSchema', () => {
  it('accepts a minimal draft and applies default addonIds', () => {
    const r = DraftOrderItemSchema.parse({ menuItemId: UUID, quantity: 1 });
    expect(r.addonIds).toEqual([]);
    expect(r.notes).toBeNull();
  });

  it('rejects quantity below 1 and above 999', () => {
    expect(() => DraftOrderItemSchema.parse({ menuItemId: UUID, quantity: 0 })).toThrow();
    expect(() => DraftOrderItemSchema.parse({ menuItemId: UUID, quantity: 1000 })).toThrow();
  });

  it('rejects non-integer quantity', () => {
    expect(() => DraftOrderItemSchema.parse({ menuItemId: UUID, quantity: 1.5 })).toThrow();
  });

  it('rejects non-uuid menuItemId', () => {
    expect(() => DraftOrderItemSchema.parse({ menuItemId: 'nope', quantity: 1 })).toThrow();
  });

  it('rejects unknown fields (strict)', () => {
    expect(() =>
      DraftOrderItemSchema.parse({ menuItemId: UUID, quantity: 1, foo: 'bar' }),
    ).toThrow();
  });

  it('coerces empty-string notes to null', () => {
    const r = DraftOrderItemSchema.parse({ menuItemId: UUID, quantity: 1, notes: '  ' });
    // trim then empty -> null
    expect(r.notes).toBeNull();
  });

  it('caps addonIds at 20', () => {
    const many = Array.from({ length: 21 }, () => UUID2);
    expect(() =>
      DraftOrderItemSchema.parse({ menuItemId: UUID, quantity: 1, addonIds: many }),
    ).toThrow();
  });
});

describe('CreateOrderSchema', () => {
  it('defaults orderType to dine_in and requires tableId for dine_in', () => {
    expect(() => CreateOrderSchema.parse({})).toThrow();
  });

  it('accepts dine_in with tableId', () => {
    const r = CreateOrderSchema.parse({ tableId: UUID });
    expect(r.orderType).toBe('dine_in');
  });

  it('rejects takeaway with tableId', () => {
    expect(() =>
      CreateOrderSchema.parse({ orderType: 'takeaway', tableId: UUID }),
    ).toThrow();
  });

  it('accepts takeaway without tableId', () => {
    const r = CreateOrderSchema.parse({ orderType: 'takeaway' });
    expect(r.tableId).toBeUndefined();
  });

  it('accepts optional initial items', () => {
    const r = CreateOrderSchema.parse({
      tableId: UUID,
      items: [{ menuItemId: UUID2, quantity: 2 }],
    });
    expect(r.items).toHaveLength(1);
    expect(r.items?.[0]?.addonIds).toEqual([]);
  });

  it('rejects pax of 0', () => {
    expect(() => CreateOrderSchema.parse({ tableId: UUID, pax: 0 })).toThrow();
  });
});

describe('AddOrderItemsSchema', () => {
  it('requires at least one item', () => {
    expect(() => AddOrderItemsSchema.parse({ items: [] })).toThrow();
  });

  it('caps at 100 items', () => {
    const many = Array.from({ length: 101 }, () => ({ menuItemId: UUID, quantity: 1 }));
    expect(() => AddOrderItemsSchema.parse({ items: many })).toThrow();
  });
});

describe('VoidOrderItemSchema + CancelOrderSchema', () => {
  it('requires a non-empty reason', () => {
    expect(() => VoidOrderItemSchema.parse({ reason: '' })).toThrow();
    expect(() => CancelOrderSchema.parse({ reason: '' })).toThrow();
  });

  it('trims and accepts a reason', () => {
    const r = VoidOrderItemSchema.parse({ reason: '  burnt  ' });
    expect(r.reason).toBe('burnt');
  });
});

describe('UpdateKotStatusSchema', () => {
  it('accepts in_progress without a reason', () => {
    const r = UpdateKotStatusSchema.parse({ status: 'in_progress' });
    expect(r.status).toBe('in_progress');
  });

  it('requires a reason for void', () => {
    expect(() => UpdateKotStatusSchema.parse({ status: 'void' })).toThrow();
  });

  it('accepts void with reason', () => {
    const r = UpdateKotStatusSchema.parse({ status: 'void', reason: 'fire' });
    expect(r.status).toBe('void');
  });

  it('rejects status=new (KOTs cannot be returned to new)', () => {
    expect(() => UpdateKotStatusSchema.parse({ status: 'new' })).toThrow();
  });

  it('rejects unknown status', () => {
    expect(() => UpdateKotStatusSchema.parse({ status: 'foo' })).toThrow();
  });
});
