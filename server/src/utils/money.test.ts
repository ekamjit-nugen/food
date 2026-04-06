import { describe, it, expect } from 'vitest';
import { applyBps, bpsToMultiplier, formatPaise, paiseToRupees, rupeesToPaise } from './money.js';

describe('money', () => {
  describe('rupeesToPaise', () => {
    it('converts whole rupees', () => {
      expect(rupeesToPaise(100)).toBe(10_000);
    });

    it('rounds decimal rupees to nearest paise', () => {
      expect(rupeesToPaise(99.994)).toBe(9999);
      expect(rupeesToPaise(99.995)).toBe(10_000);
    });

    it('handles zero and negative', () => {
      expect(rupeesToPaise(0)).toBe(0);
      expect(rupeesToPaise(-12.5)).toBe(-1250);
    });

    it('throws on non-finite', () => {
      expect(() => rupeesToPaise(Number.NaN)).toThrow();
      expect(() => rupeesToPaise(Number.POSITIVE_INFINITY)).toThrow();
    });
  });

  describe('paiseToRupees', () => {
    it('is the inverse of rupeesToPaise for integers', () => {
      expect(paiseToRupees(rupeesToPaise(250))).toBe(250);
    });
  });

  describe('formatPaise', () => {
    it('pads paise to two digits', () => {
      expect(formatPaise(10_005)).toBe('₹100.05');
      expect(formatPaise(10_050)).toBe('₹100.50');
    });

    it('handles zero', () => {
      expect(formatPaise(0)).toBe('₹0.00');
    });

    it('handles negatives', () => {
      expect(formatPaise(-1234)).toBe('-₹12.34');
    });

    it('accepts a custom currency symbol', () => {
      expect(formatPaise(12_345, '$')).toBe('$123.45');
    });
  });

  describe('bpsToMultiplier', () => {
    it('converts basis points', () => {
      expect(bpsToMultiplier(500)).toBe(0.05);
      expect(bpsToMultiplier(1800)).toBe(0.18);
    });
  });

  describe('applyBps', () => {
    it('applies a rate and rounds to nearest paise', () => {
      // 100 INR @ 5% GST = 5 INR = 500 paise
      expect(applyBps(10_000, 500)).toBe(500);
    });

    it('rounds half-up at the paise boundary', () => {
      // 333 paise @ 5% = 16.65 → 17
      expect(applyBps(333, 500)).toBe(17);
    });

    it('returns zero for zero rate', () => {
      expect(applyBps(99_999, 0)).toBe(0);
    });
  });
});
