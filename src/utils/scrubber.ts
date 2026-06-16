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
