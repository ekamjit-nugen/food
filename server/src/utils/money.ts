/**
 * Money helpers.
 *
 * RULE: inside the system, money is ALWAYS integer paise (1 INR = 100 paise).
 * Never store or compute money as JavaScript numbers-with-decimals. Floats
 * silently destroy billing correctness (0.1 + 0.2 !== 0.3). Parse at input,
 * format at output, integer in between.
 */
export type Paise = number;

const PAISE_PER_RUPEE = 100;

export function rupeesToPaise(rupees: number): Paise {
  if (!Number.isFinite(rupees)) throw new Error('rupees must be finite');
  // Round to nearest paise to defend against float input from UI.
  return Math.round(rupees * PAISE_PER_RUPEE);
}

export function paiseToRupees(paise: Paise): number {
  return paise / PAISE_PER_RUPEE;
}

export function formatPaise(paise: Paise, currency = '₹'): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / PAISE_PER_RUPEE);
  const p = abs % PAISE_PER_RUPEE;
  return `${sign}${currency}${rupees}.${p.toString().padStart(2, '0')}`;
}

/**
 * Convert basis points (bps) to a multiplier.
 * 500 bps = 5% = 0.05. We store tax rates as bps integers to avoid floats.
 */
export function bpsToMultiplier(bps: number): number {
  return bps / 10_000;
}

/**
 * Apply a bps rate to an integer paise amount, rounding to nearest paise.
 * Use this for line-level tax computation.
 */
export function applyBps(amountPaise: Paise, bps: number): Paise {
  return Math.round((amountPaise * bps) / 10_000);
}
