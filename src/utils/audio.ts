/**
 * Audio analysis helpers — used to skip the blank/silent lead-in at the start
 * of a song so the start-time slider and timestamp are relative to where the
 * music actually begins, not the raw 0:00 of the file.
 */

/**
 * Find where audible sound begins in a mono PCM signal, in seconds.
 *
 * Scans the signal in short windows and returns the start of the first window
 * whose mean absolute amplitude crosses `threshold`. Window-averaging (rather
 * than a single-sample test) avoids a stray click or noise sample triggering a
 * false onset. Returns 0 if nothing crosses the threshold (treat as no lead-in).
 */
export function detectLeadIn(
  samples: Float32Array,
  sampleRate: number,
  { threshold = 0.02, windowMs = 20 }: { threshold?: number; windowMs?: number } = {},
): number {
  if (!sampleRate || samples.length === 0) return 0;
  const win = Math.max(1, Math.floor((windowMs / 1000) * sampleRate));
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let j = i; j < i + win; j++) sum += Math.abs(samples[j]!);
    if (sum / win >= threshold) return i / sampleRate;
  }
  return 0;
}

/**
 * Downsample a PCM signal into `buckets` peak amplitudes (max |sample| per
 * bucket), normalized to 0..1, for drawing a waveform. Scans from `startIndex`
 * (e.g. past the leading silence) to the end. Returns fewer buckets than asked
 * only when the signal is shorter than the bucket count.
 */
export function computePeaks(
  samples: Float32Array,
  startIndex: number,
  buckets: number,
): number[] {
  const start = Math.max(0, Math.min(startIndex, samples.length));
  const len = samples.length - start;
  if (len <= 0 || buckets <= 0) return [];
  const n = Math.min(buckets, len);
  const size = len / n;
  const peaks = new Array<number>(n);
  let max = 0;
  for (let b = 0; b < n; b++) {
    const s = start + Math.floor(b * size);
    const e = b === n - 1 ? samples.length : start + Math.floor((b + 1) * size);
    let m = 0;
    for (let i = s; i < e; i++) {
      const a = Math.abs(samples[i]!);
      if (a > m) m = a;
    }
    peaks[b] = m;
    if (m > max) max = m;
  }
  if (max > 0) for (let b = 0; b < n; b++) peaks[b]! /= max;
  return peaks;
}
