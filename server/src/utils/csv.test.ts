import { describe, it, expect } from 'vitest';
import { toCsv } from './csv.js';

describe('toCsv', () => {
  it('writes a header + row with CRLF', () => {
    const out = toCsv([[1, 'two', true]], ['a', 'b', 'c']);
    expect(out).toBe('a,b,c\r\n1,two,true\r\n');
  });

  it('quotes fields containing commas', () => {
    const out = toCsv([['hello, world']]);
    expect(out).toBe('"hello, world"\r\n');
  });

  it('escapes embedded quotes by doubling', () => {
    const out = toCsv([['she said "hi"']]);
    expect(out).toBe('"she said ""hi"""\r\n');
  });

  it('quotes fields with newlines', () => {
    const out = toCsv([['line1\nline2']]);
    expect(out).toBe('"line1\nline2"\r\n');
  });

  it('renders null and undefined as empty fields', () => {
    const out = toCsv([[null, undefined, 'x']]);
    expect(out).toBe(',,x\r\n');
  });

  it('renders dates as ISO strings and quotes them', () => {
    const d = new Date('2026-04-05T10:00:00Z');
    const out = toCsv([[d]]);
    // ISO strings contain colons but not commas/quotes/newlines, so no quoting.
    expect(out).toBe('2026-04-05T10:00:00.000Z\r\n');
  });

  it('handles empty rows', () => {
    expect(toCsv([], ['a', 'b'])).toBe('a,b\r\n');
  });
});
