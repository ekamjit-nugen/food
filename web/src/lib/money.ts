/**
 * All monetary values in the backend are integer paise. Never introduce float
 * arithmetic into price handling — convert to display only at the render edge.
 *
 * Locale: the friend's outlet is in India, so we default to en-IN + INR. If
 * this changes we read it from a tenant config; not worth a setting yet.
 */

const formatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPaise(paise: number): string {
  return formatter.format(paise / 100);
}

/**
 * Parse a rupees-with-decimal string (e.g. "120", "99.50") into integer paise.
 * Returns null on invalid input. We intentionally avoid parseFloat and any
 * binary-float arithmetic so every conversion lands on an exact paisa.
 */
export function parseAmountToPaise(input: string): number | null {
  const s = input.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const paddedFrac = (frac + '00').slice(0, 2);
  const n = Number(whole) * 100 + Number(paddedFrac);
  return Number.isFinite(n) ? n : null;
}

/** Inverse of parseAmountToPaise, for populating edit forms. */
export function paiseToAmountString(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${sign}${whole}.${frac}`;
}
