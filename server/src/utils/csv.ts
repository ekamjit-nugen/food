/**
 * Minimal CSV writer. No dependency — CSV is trivial if you get the
 * quoting rule right and DO NOT improvise.
 *
 * Quoting rule (RFC 4180):
 *   - Wrap a field in double quotes if it contains a comma, quote, CR, or LF.
 *   - Escape embedded quotes by doubling them ("" instead of \").
 *   - Do NOT trim — trailing whitespace is meaningful in exports.
 *
 * null/undefined render as an empty field. Dates render as ISO strings.
 * Numbers render via String(). Callers should convert money to rupees
 * themselves before passing — the helper stays type-agnostic.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

export function toCsv(rows: CsvValue[][], headers?: string[]): string {
  const lines: string[] = [];
  if (headers) lines.push(headers.map(escapeField).join(','));
  for (const row of rows) {
    lines.push(row.map(formatField).join(','));
  }
  // CRLF line endings per RFC 4180 — Excel-safe.
  return lines.join('\r\n') + '\r\n';
}

function formatField(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return escapeField(v.toISOString());
  return escapeField(String(v));
}

function escapeField(s: string): string {
  if (s.length === 0) return '';
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
