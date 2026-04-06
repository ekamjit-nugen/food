import { describe, it, expect } from 'vitest';
import { computeBill, resolveDiscountPaise, type EngineLineInput } from './billing.engine.js';

function line(overrides: Partial<EngineLineInput> = {}): EngineLineInput {
  return {
    orderItemId: 'oi-1',
    menuItemName: 'Paneer Tikka',
    variationName: null,
    quantity: 1,
    unitPricePaise: 25000, // ₹250.00
    addonsPerUnitPaise: 0,
    taxRateBps: 500, // 5% GST
    ...overrides,
  };
}

describe('computeBill — basics', () => {
  it('throws on empty lines', () => {
    expect(() => computeBill([], null)).toThrow();
  });

  it('single item, no discount, no addon', () => {
    const r = computeBill([line()], null);
    // 250.00 + 5% GST = 262.50 → rounded nearest rupee = 263.00, round-off = 50
    expect(r.subtotalPaise).toBe(25000);
    expect(r.discountPaise).toBe(0);
    expect(r.taxablePaise).toBe(25000);
    expect(r.totalTaxPaise).toBe(1250);
    expect(r.cgstPaise).toBe(625);
    expect(r.sgstPaise).toBe(625);
    expect(r.preRoundTotalPaise).toBe(26250);
    expect(r.totalPaise).toBe(26300);
    expect(r.roundOffPaise).toBe(50);
    // CGST + SGST must exactly equal tax.
    expect(r.cgstPaise + r.sgstPaise).toBe(r.totalTaxPaise);
  });

  it('multiple quantities multiply correctly', () => {
    const r = computeBill([line({ quantity: 3 })], null);
    // 3 * 250 = 750, +5% = 787.50 → 788
    expect(r.subtotalPaise).toBe(75000);
    expect(r.totalTaxPaise).toBe(3750);
    expect(r.preRoundTotalPaise).toBe(78750);
    expect(r.totalPaise).toBe(78800);
    expect(r.roundOffPaise).toBe(50);
  });

  it('addons are added to the per-unit price then multiplied by qty', () => {
    const r = computeBill(
      [line({ addonsPerUnitPaise: 2000, quantity: 2 })], // (250 + 20) * 2 = 540
      null,
    );
    expect(r.subtotalPaise).toBe(54000);
    expect(r.lines[0]!.addonsPaise).toBe(4000); // per-unit addon * qty
    expect(r.lines[0]!.lineSubtotalPaise).toBe(54000);
  });

  it('splits CGST and SGST with odd paise going to SGST', () => {
    // Pick a total that makes tax odd: 501 paise @ 5% = 25.05 → 25 paise
    // Use 30000 paise @ 501 bps: 30000 * 501 / 10000 = 1503 → cgst=751, sgst=752
    const r = computeBill([line({ unitPricePaise: 30000, taxRateBps: 501 })], null);
    expect(r.totalTaxPaise).toBe(1503);
    expect(r.cgstPaise).toBe(751);
    expect(r.sgstPaise).toBe(752);
    expect(r.cgstPaise + r.sgstPaise).toBe(r.totalTaxPaise);
  });
});

describe('computeBill — discounts', () => {
  it('flat discount reduces subtotal before tax', () => {
    const r = computeBill(
      [line()], // 250 subtotal
      { type: 'flat', valuePaise: 5000, reason: 'loyal customer' },
    );
    // taxable = 250 - 50 = 200, tax 5% = 10, total = 210 → rounded 210
    expect(r.discountPaise).toBe(5000);
    expect(r.taxablePaise).toBe(20000);
    expect(r.totalTaxPaise).toBe(1000);
    expect(r.preRoundTotalPaise).toBe(21000);
    expect(r.totalPaise).toBe(21000);
    expect(r.roundOffPaise).toBe(0);
  });

  it('percent discount applies across the whole subtotal', () => {
    const r = computeBill(
      [line(), line({ orderItemId: 'oi-2', unitPricePaise: 15000 })], // 250 + 150 = 400
      { type: 'percent', valueBps: 1000, reason: '10% off' },
    );
    // 10% of 400 = 40
    expect(r.subtotalPaise).toBe(40000);
    expect(r.discountPaise).toBe(4000);
    expect(r.taxablePaise).toBe(36000);
    // tax: 36000 * 5% = 1800 → cgst 900, sgst 900
    expect(r.totalTaxPaise).toBe(1800);
  });

  it('discount is pro-rated across lines and sums exactly to discountPaise', () => {
    const r = computeBill(
      [
        line({ orderItemId: 'a', unitPricePaise: 10000 }),
        line({ orderItemId: 'b', unitPricePaise: 20000 }),
        line({ orderItemId: 'c', unitPricePaise: 30000 }),
      ],
      { type: 'flat', valuePaise: 1000, reason: 'x' },
    );
    const totalBillShare = r.lines.reduce((a, l) => a + l.billDiscountSharePaise, 0);
    expect(totalBillShare).toBe(r.discountPaise);
  });

  it('flat discount is capped at the subtotal (no negative totals)', () => {
    const r = computeBill(
      [line({ unitPricePaise: 10000 })], // 100
      { type: 'flat', valuePaise: 99999999, reason: 'comp' },
    );
    expect(r.discountPaise).toBe(10000);
    expect(r.taxablePaise).toBe(0);
    expect(r.totalTaxPaise).toBe(0);
    expect(r.totalPaise).toBe(0);
  });

  it('100% discount zeroes out the bill', () => {
    const r = computeBill([line()], {
      type: 'percent',
      valueBps: 10_000,
      reason: 'comp',
    });
    expect(r.taxablePaise).toBe(0);
    expect(r.totalPaise).toBe(0);
  });
});

describe('computeBill — line-level discounts', () => {
  it('per-line discount reduces that line only', () => {
    const r = computeBill(
      [
        line({
          orderItemId: 'a',
          unitPricePaise: 20000, // 200
          discount: { type: 'flat', valuePaise: 5000, reason: 'chef promo' },
        }),
        line({ orderItemId: 'b', unitPricePaise: 10000 }), // 100, no discount
      ],
      null,
    );
    expect(r.subtotalPaise).toBe(30000);
    expect(r.lineDiscountTotalPaise).toBe(5000);
    expect(r.discountPaise).toBe(0); // no bill-level discount
    expect(r.taxablePaise).toBe(25000); // 200 - 50 + 100
    // Line A: 200 - 50 = 150 taxable
    expect(r.lines[0]!.lineDiscountPaise).toBe(5000);
    expect(r.lines[0]!.billDiscountSharePaise).toBe(0);
    expect(r.lines[0]!.lineTaxablePaise).toBe(15000);
    // Line B untouched by A's discount
    expect(r.lines[1]!.lineDiscountPaise).toBe(0);
    expect(r.lines[1]!.lineTaxablePaise).toBe(10000);
  });

  it('per-line flat discount is capped at that line subtotal', () => {
    const r = computeBill(
      [
        line({
          unitPricePaise: 10000,
          discount: { type: 'flat', valuePaise: 99_999_999, reason: 'comp' },
        }),
      ],
      null,
    );
    expect(r.lines[0]!.lineDiscountPaise).toBe(10000);
    expect(r.lines[0]!.lineTaxablePaise).toBe(0);
    expect(r.totalPaise).toBe(0);
  });

  it('per-line percent discount works independently per line', () => {
    const r = computeBill(
      [
        line({
          orderItemId: 'a',
          unitPricePaise: 20000,
          discount: { type: 'percent', valueBps: 2500, reason: '25%' },
        }),
        line({ orderItemId: 'b', unitPricePaise: 10000 }),
      ],
      null,
    );
    expect(r.lines[0]!.lineDiscountPaise).toBe(5000); // 25% of 200
    expect(r.lines[1]!.lineDiscountPaise).toBe(0);
    expect(r.lineDiscountTotalPaise).toBe(5000);
  });

  it('stacks line + bill: bill discount pro-rates over post-line-discount weights', () => {
    // A: 200 - 50% line = 100 remaining
    // B: 100, no line discount = 100 remaining
    // Post-line subtotal: 200. Bill 10% => 20 discount.
    // Pro-rata: A gets 20 * 100/200 = 10, B gets 20 * 100/200 = 10.
    const r = computeBill(
      [
        line({
          orderItemId: 'a',
          unitPricePaise: 20000,
          discount: { type: 'percent', valueBps: 5000, reason: '50% off A' },
        }),
        line({ orderItemId: 'b', unitPricePaise: 10000 }),
      ],
      { type: 'percent', valueBps: 1000, reason: '10% loyalty' },
    );
    expect(r.subtotalPaise).toBe(30000);
    expect(r.lineDiscountTotalPaise).toBe(10000);
    expect(r.discountPaise).toBe(2000); // 10% of 20000 post-line
    expect(r.taxablePaise).toBe(18000);
    expect(r.lines[0]!.lineDiscountPaise).toBe(10000);
    expect(r.lines[0]!.billDiscountSharePaise).toBe(1000);
    expect(r.lines[0]!.lineTaxablePaise).toBe(9000);
    expect(r.lines[1]!.lineDiscountPaise).toBe(0);
    expect(r.lines[1]!.billDiscountSharePaise).toBe(1000);
    expect(r.lines[1]!.lineTaxablePaise).toBe(9000);
  });

  it('a fully-line-discounted line absorbs none of the bill discount', () => {
    const r = computeBill(
      [
        line({
          orderItemId: 'a',
          unitPricePaise: 10000,
          discount: { type: 'percent', valueBps: 10_000, reason: 'comp' },
        }),
        line({ orderItemId: 'b', unitPricePaise: 10000 }),
      ],
      { type: 'flat', valuePaise: 1000, reason: 'bill promo' },
    );
    // A zeroed, so bill discount lands entirely on B.
    expect(r.lines[0]!.billDiscountSharePaise).toBe(0);
    expect(r.lines[1]!.billDiscountSharePaise).toBe(1000);
  });

  it('bill-level discount caps against POST-line-discount subtotal', () => {
    // Gross 200, line discount 150, post-line = 50. A flat 10000 bill discount
    // should cap at 50 (not at 200).
    const r = computeBill(
      [
        line({
          unitPricePaise: 20000,
          discount: { type: 'flat', valuePaise: 15000, reason: 'line' },
        }),
      ],
      { type: 'flat', valuePaise: 10000, reason: 'bill' },
    );
    expect(r.lineDiscountTotalPaise).toBe(15000);
    expect(r.discountPaise).toBe(5000); // capped at 50
    expect(r.taxablePaise).toBe(0);
  });
});

describe('computeBill — rounding', () => {
  it('rounds total DOWN when below .50', () => {
    // 250 + 5% = 262.50 — borderline, halves go up
    const r = computeBill([line({ unitPricePaise: 24000 })], null); // 240 + 12 = 252
    expect(r.preRoundTotalPaise).toBe(25200);
    expect(r.totalPaise).toBe(25200); // already round
    expect(r.roundOffPaise).toBe(0);
  });

  it('rounds total UP and leaves a positive round-off', () => {
    // 250 + 5% = 262.50 → 263.00 (Math.round half-to-even-ish; JS Math.round rounds half up toward +Inf)
    const r = computeBill([line()], null);
    expect(r.roundOffPaise).toBeGreaterThanOrEqual(0);
    expect(r.totalPaise % 100).toBe(0);
  });

  it('round-off + pre-round equals total, always', () => {
    const cases: EngineLineInput[][] = [
      [line()],
      [line({ quantity: 7 })],
      [line({ unitPricePaise: 12345, taxRateBps: 1800 })],
      [line({ unitPricePaise: 99, taxRateBps: 500, quantity: 13 })],
    ];
    for (const lines of cases) {
      const r = computeBill(lines, null);
      expect(r.preRoundTotalPaise + r.roundOffPaise).toBe(r.totalPaise);
      expect(r.totalPaise % 100).toBe(0);
    }
  });
});

describe('computeBill — invariants', () => {
  it('line totals sum consistent with bill totals', () => {
    const r = computeBill(
      [
        line({ unitPricePaise: 10000, quantity: 2 }),
        line({ unitPricePaise: 35000, taxRateBps: 1800 }),
        line({ unitPricePaise: 8000, addonsPerUnitPaise: 1500, quantity: 3 }),
      ],
      { type: 'percent', valueBps: 500, reason: '5% off' },
    );
    const sumLineSubtotal = r.lines.reduce((a, l) => a + l.lineSubtotalPaise, 0);
    expect(sumLineSubtotal).toBe(r.subtotalPaise);

    const sumBillShare = r.lines.reduce((a, l) => a + l.billDiscountSharePaise, 0);
    expect(sumBillShare).toBe(r.discountPaise);
    const sumLineDiscount = r.lines.reduce((a, l) => a + l.lineDiscountPaise, 0);
    expect(sumLineDiscount).toBe(r.lineDiscountTotalPaise);

    const sumCgst = r.lines.reduce((a, l) => a + l.cgstPaise, 0);
    const sumSgst = r.lines.reduce((a, l) => a + l.sgstPaise, 0);
    expect(sumCgst).toBe(r.cgstPaise);
    expect(sumSgst).toBe(r.sgstPaise);

    for (const l of r.lines) {
      expect(l.cgstPaise + l.sgstPaise).toBe(l.lineTaxPaise);
      expect(l.lineTaxablePaise + l.lineTaxPaise).toBe(l.lineTotalPaise);
    }
  });

  it('rejects negative prices and zero quantities', () => {
    expect(() => computeBill([line({ unitPricePaise: -1 })], null)).toThrow();
    expect(() => computeBill([line({ quantity: 0 })], null)).toThrow();
  });
});

describe('resolveDiscountPaise', () => {
  it('null discount returns zero', () => {
    expect(resolveDiscountPaise(10000, null)).toBe(0);
  });
  it('flat is capped at subtotal', () => {
    expect(
      resolveDiscountPaise(10000, { type: 'flat', valuePaise: 50000, reason: 'x' }),
    ).toBe(10000);
  });
  it('percent respects bps bounds', () => {
    expect(
      resolveDiscountPaise(10000, { type: 'percent', valueBps: 2500, reason: 'x' }),
    ).toBe(2500);
  });
  it('rejects bps > 10000', () => {
    expect(() =>
      resolveDiscountPaise(10000, { type: 'percent', valueBps: 10_001, reason: 'x' }),
    ).toThrow();
  });
  it('rejects negative flat', () => {
    expect(() =>
      resolveDiscountPaise(10000, { type: 'flat', valuePaise: -1, reason: 'x' }),
    ).toThrow();
  });
});
