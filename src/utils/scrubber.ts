/**
 * Pure geometry/clamping helpers for the audio scrubber's two-handle track
 * (a start marker + a playhead). Kept separate from the component so the
 * clamping rules — notably "the playhead can never sit before the start
 * marker" — can be unit-tested.
 */

/** Clamp `value` to the inclusive range [lo, hi]. Tolerant of hi < lo. */
export function clamp(value: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Convert a pointer's `clientX` over a track element into a time in
 * [0, duration]. Returns 0 for a zero-width track or zero-length audio.
 */
export function positionToTime(
  clientX: number,
  trackLeft: number,
  trackWidth: number,
  duration: number,
): number {
  if (trackWidth <= 0 || duration <= 0) return 0;
  return clamp((clientX - trackLeft) / trackWidth, 0, 1) * duration;
}

/** Position (0–100%) of a time on the track, for absolute CSS placement. */
export function timeToPercent(time: number, duration: number): number {
  if (duration <= 0) return 0;
  return clamp(time / duration, 0, 1) * 100;
}

/**
 * Build an SVG path (a filled, vertically-mirrored envelope) for a normalized
 * peaks array, in a `0 0 (n-1) 2` viewBox centered on y=1. Rendered with
 * preserveAspectRatio="none" so it stretches to the track's width/height.
 * Returns '' for empty input.
 */
export function waveformPath(peaks: number[]): string {
  const n = peaks.length;
  if (n === 0) return '';
  let top = '';
  let bottom = '';
  for (let i = 0; i < n; i++) {
    const p = clamp(peaks[i]!, 0, 1);
    top += `${i === 0 ? 'M' : 'L'}${i},${(1 - p).toFixed(3)}`;
    const j = n - 1 - i; // walk back for the mirrored bottom edge
    bottom += `L${j},${(1 + clamp(peaks[j]!, 0, 1)).toFixed(3)}`;
  }
  return `${top}${bottom}Z`;
}
