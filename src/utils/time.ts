/** Format/parse timestamps for the start-time UI, with millisecond precision. */

/**
 * Format seconds as `m:ss.mmm`. Computed from total milliseconds so float
 * rounding can't split wrong (e.g. 12.9996s must read 0:13.000, not 0:12.1000).
 * Negative inputs clamp to 0 (start times are never negative).
 */
export function formatTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const m = Math.floor(totalMs / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

/**
 * Parse `m:ss.mmm`, `ss.mmm`, or a plain (fractional) seconds value into
 * seconds. The seconds component is parsed as a float so millisecond input
 * survives. Returns null for blank/unparseable input.
 */
export function parseTime(value: string): number | null {
  const parts = value.trim().split(':');
  if (parts.length === 2) {
    const m = parseInt(parts[0]!, 10);
    const s = parseFloat(parts[1]!);
    if (!isNaN(m) && !isNaN(s)) return m * 60 + s;
  }
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}
