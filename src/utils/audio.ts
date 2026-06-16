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
