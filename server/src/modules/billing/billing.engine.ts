import { applyBps, type Paise } from '../../utils/money.js';

/**
 * Billing engine — pure functions, no DB access, no I/O.
 *
 * The ONE place where money math lives. Called from the service layer with
 * the current order state, returns a fully-computed bill ready to persist.
 *
 * Assumptions baked in for v1 (single outlet, single tax regime):
 *   - Tax is EXCLUSIVE. Menu prices are pre-tax. Add tax on top.
 *   - GST is split 50/50 into CGST and SGST at the line level. Rounding
 *     rule: cgst = floor(tax/2), sgst = tax - cgst, so cgst+sgst == tax,
 *     always.
 *   - Discounts stack in TWO STAGES:
 *       1. Per-line discount (optional per input line). Capped at the line's
 *          own subtotal. A flat value > line subtotal zeroes the line; a
 *          percent > 100% is rejected at input time.
 *       2. Bill-level discount applied to the SUM of post-line-discount
 *          lines. Pro-rated back over lines by each line's post-line-discount
 *          share (so a heavily-discounted line absorbs less of the bill
 *          discount — matches how real POS systems behave).
 *     Tax is computed on each line's final taxable (subtotal - line discount
 *     - bill discount share) so the tax-summary report still reconciles
 *     line-by-line.
 *   - Final bill total is rounded to the nearest rupee. The delta lives
 *     in round_off_paise (can be negative).
 */

export interface EngineLineInput {
  /** order_items.id — round-trips through so the service can map back. */
  orderItemId: string;
  menuItemName: string;
  variationName: string | null;
  quantity: number;
  unitPricePaise: Paise;
  /** sum of addon.pricePaise for a single unit (not multiplied by qty). */
  addonsPerUnitPaise: Paise;
  /** total GST rate in basis points. Split 50/50 into CGST + SGST. */
  taxRateBps: number;
  /** Optional per-line discount. Stage 1 in the stacking model. */
  discount?: EngineDiscount;
}

export type EngineDiscount =
  | { type: 'flat'; valuePaise: Paise; reason: string }
  | { type: 'percent'; valueBps: number; reason: string }
  | null;

export interface EngineLineOutput {
  orderItemId: string;
  menuItemName: string;
  variationName: string | null;
  quantity: number;
  unitPricePaise: Paise;
  /** total addon value for this LINE (per-unit * qty). */
  addonsPaise: Paise;
  /** (unitPrice + addonsPerUnit) * qty — pre-discount, pre-tax. */
  lineSubtotalPaise: Paise;
  /** Stage-1 per-line discount applied to this line (0 if none). */
  lineDiscountPaise: Paise;
  /** Stage-2 share of the bill-level discount assigned to this line. */
  billDiscountSharePaise: Paise;
  /** lineSubtotal - lineDiscount - billDiscountShare. Tax computed on this. */
  lineTaxablePaise: Paise;
  taxRateBps: number;
  cgstPaise: Paise;
  sgstPaise: Paise;
  lineTaxPaise: Paise;
  /** lineTaxable + lineTax. What shows on the printed line. */
  lineTotalPaise: Paise;
}

export interface EngineBillOutput {
  /** Gross, before any discount. */
  subtotalPaise: Paise;
  /** Sum of stage-1 per-line discounts. */
  lineDiscountTotalPaise: Paise;
  /** Stage-2 bill-level discount (computed against post-line-discount sum). */
  discountPaise: Paise;
  /** subtotal - lineDiscountTotal - discount. Base for tax. */
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  totalTaxPaise: Paise;
  /** Sum of lines + tax, before nearest-rupee rounding. */
  preRoundTotalPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
  lines: EngineLineOutput[];
}

/**
 * Validate a discount spec against a base amount and return the effective
 * paise discount. A flat discount is capped at the base so you can never
 * owe a negative total. A percent discount is capped at 100%.
 */
export function resolveDiscountPaise(
  basePaise: Paise,
  discount: EngineDiscount,
): Paise {
  if (!discount) return 0;
  if (discount.type === 'flat') {
    if (discount.valuePaise < 0) throw new Error('flat discount must be non-negative');
    return Math.min(discount.valuePaise, basePaise);
  }
  if (discount.valueBps < 0 || discount.valueBps > 10_000) {
    throw new Error('percent discount must be between 0 and 10000 bps');
  }
  return applyBps(basePaise, discount.valueBps);
}

/**
 * Distribute an integer paise amount across line shares proportionally.
 * Uses largest-remainder to ensure the parts sum exactly to `total`.
 * Returns an array parallel to `weights`. Zero-weight lines get zero.
 */
function distributeByWeight(total: Paise, weights: Paise[]): Paise[] {
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || weightSum === 0) return weights.map(() => 0);

  const raw = weights.map((w) => (w * total) / weightSum);
  const floored = raw.map((r) => Math.floor(r));
  const remainders = raw.map((r, i) => ({ i, frac: r - floored[i]! }));
  let remainder = total - floored.reduce((a, b) => a + b, 0);

  // Largest-remainder: give the +1 paisa units to the lines with the biggest
  // fractional part first.
  remainders.sort((a, b) => b.frac - a.frac);
  const result = [...floored];
  for (const r of remainders) {
    if (remainder <= 0) break;
    result[r.i] = (result[r.i] ?? 0) + 1;
    remainder--;
  }
  return result;
}

/** Split a line tax amount into (cgst, sgst) such that cgst+sgst === tax. */
function splitCgstSgst(taxPaise: Paise): { cgst: Paise; sgst: Paise } {
  const cgst = Math.floor(taxPaise / 2);
  return { cgst, sgst: taxPaise - cgst };
}

/** Round a paise value to the nearest rupee (100 paise). Half rounds up. */
function roundToNearestRupee(paise: Paise): Paise {
  return Math.round(paise / 100) * 100;
}

/**
 * The main entry point. Given all (non-void) order items and an optional
 * bill-level discount, produce the fully-resolved bill. Per-line discounts
 * live on each input line.
 */
export function computeBill(
  lines: EngineLineInput[],
  discount: EngineDiscount,
): EngineBillOutput {
  if (lines.length === 0) {
    throw new Error('cannot bill an order with zero items');
  }

  // ---- line subtotals -----------------------------------------------------
  const lineSubtotals: Paise[] = lines.map((l) => {
    if (l.quantity <= 0) throw new Error('quantity must be positive');
    if (l.unitPricePaise < 0 || l.addonsPerUnitPaise < 0) {
      throw new Error('negative price');
    }
    return (l.unitPricePaise + l.addonsPerUnitPaise) * l.quantity;
  });
  const subtotalPaise = lineSubtotals.reduce((a, b) => a + b, 0);

  // ---- stage 1: per-line discounts ---------------------------------------
  const lineDiscounts: Paise[] = lines.map((l, i) =>
    resolveDiscountPaise(lineSubtotals[i]!, l.discount ?? null),
  );
  const lineDiscountTotalPaise = lineDiscounts.reduce((a, b) => a + b, 0);

  // Weights for stage 2 are the post-line-discount remainders. A line that
  // was zeroed by its own discount absorbs no bill-level discount.
  const postLineRemainders: Paise[] = lineSubtotals.map(
    (s, i) => s - lineDiscounts[i]!,
  );
  const postLineSubtotal = postLineRemainders.reduce((a, b) => a + b, 0);

  // ---- stage 2: bill-level discount + pro-rate ---------------------------
  const discountPaise = resolveDiscountPaise(postLineSubtotal, discount);
  const billDiscountShares = distributeByWeight(discountPaise, postLineRemainders);

  // ---- per-line tax + totals ---------------------------------------------
  const outLines: EngineLineOutput[] = lines.map((l, i) => {
    const lineSubtotal = lineSubtotals[i]!;
    const lineDiscount = lineDiscounts[i]!;
    const billShare = billDiscountShares[i]!;
    const lineTaxable = lineSubtotal - lineDiscount - billShare;
    const lineTax = applyBps(lineTaxable, l.taxRateBps);
    const { cgst, sgst } = splitCgstSgst(lineTax);
    return {
      orderItemId: l.orderItemId,
      menuItemName: l.menuItemName,
      variationName: l.variationName,
      quantity: l.quantity,
      unitPricePaise: l.unitPricePaise,
      addonsPaise: l.addonsPerUnitPaise * l.quantity,
      lineSubtotalPaise: lineSubtotal,
      lineDiscountPaise: lineDiscount,
      billDiscountSharePaise: billShare,
      lineTaxablePaise: lineTaxable,
      taxRateBps: l.taxRateBps,
      cgstPaise: cgst,
      sgstPaise: sgst,
      lineTaxPaise: lineTax,
      lineTotalPaise: lineTaxable + lineTax,
    };
  });

  // ---- bill-level aggregates ---------------------------------------------
  const taxablePaise = subtotalPaise - lineDiscountTotalPaise - discountPaise;
  const cgstPaise = outLines.reduce((a, l) => a + l.cgstPaise, 0);
  const sgstPaise = outLines.reduce((a, l) => a + l.sgstPaise, 0);
  const totalTaxPaise = cgstPaise + sgstPaise;
  const preRoundTotalPaise = taxablePaise + totalTaxPaise;
  const totalPaise = roundToNearestRupee(preRoundTotalPaise);
  const roundOffPaise = totalPaise - preRoundTotalPaise;

  return {
    subtotalPaise,
    lineDiscountTotalPaise,
    discountPaise,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    totalTaxPaise,
    preRoundTotalPaise,
    roundOffPaise,
    totalPaise,
    lines: outLines,
  };
}
