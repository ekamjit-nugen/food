/**
 * Integer paise in, locale string out. Mirrors web/src/lib/money.ts.
 * Hermes ships Intl.NumberFormat so en-IN + INR works on both platforms.
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

export function parseAmountToPaise(input: string): number | null {
  const s = input.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const paddedFrac = (frac + '00').slice(0, 2);
  const n = Number(whole) * 100 + Number(paddedFrac);
  return Number.isFinite(n) ? n : null;
}

export function paiseToAmountString(paise: number): string {
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${paise < 0 ? '-' : ''}${whole}.${frac}`;
}
