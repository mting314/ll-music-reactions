import { test, expect } from 'bun:test';
import { detectLeadIn, computePeaks } from './audio';

const SR = 1000; // 1kHz keeps the math easy: 1 sample = 1ms

function silence(n: number): number[] {
  return new Array(n).fill(0);
}

function tone(n: number, amp = 0.5): number[] {
  // alternating +/- amp so the mean absolute amplitude is `amp`
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? amp : -amp));
}

test('returns 0 when sound starts immediately', () => {
  const buf = new Float32Array(tone(1000));
  expect(detectLeadIn(buf, SR)).toBe(0);
});

test('skips leading silence to the music onset', () => {
  // 500ms of silence, then a tone
  const buf = new Float32Array([...silence(500), ...tone(1000)]);
  // window is 20ms (20 samples); onset detected at the first window inside the tone
  expect(detectLeadIn(buf, SR)).toBeCloseTo(0.5, 2);
});

test('returns 0 for fully silent input', () => {
  const buf = new Float32Array(silence(2000));
  expect(detectLeadIn(buf, SR)).toBe(0);
});

test('ignores a single stray sample below the windowed threshold', () => {
  // one loud spike amid silence, then real sound later
  const stray = silence(2000);
  stray[100] = 0.9;
  const buf = new Float32Array([...stray, ...tone(1000)]);
  // a lone spike averages to 0.9/20 ≈ 0.045 over its window — above default
  // 0.02, so it WOULD trip a naive test. Use a higher threshold to assert the
  // windowing math: with threshold 0.1 the spike is ignored, tone is found.
  expect(detectLeadIn(buf, SR, { threshold: 0.1 })).toBeCloseTo(2.0, 1);
});

test('handles empty input and zero sample rate', () => {
  expect(detectLeadIn(new Float32Array(0), SR)).toBe(0);
  expect(detectLeadIn(new Float32Array(tone(100)), 0)).toBe(0);
});

test('computePeaks downsamples to N normalized buckets', () => {
  // 100 samples ramping 0..0.5; 4 buckets → increasing peaks, normalized to 1
  const data = new Float32Array(Array.from({ length: 100 }, (_, i) => (i / 100) * 0.5));
  const peaks = computePeaks(data, 0, 4);
  expect(peaks).toHaveLength(4);
  expect(peaks[3]).toBeCloseTo(1, 5); // loudest bucket normalized to 1
  expect(peaks[0]! < peaks[3]!).toBe(true); // increasing
  expect(Math.max(...peaks)).toBeLessThanOrEqual(1);
});

test('computePeaks skips a leading offset (silence)', () => {
  const data = new Float32Array([...new Array(50).fill(0), ...tone(50, 0.5)]);
  const peaks = computePeaks(data, 50, 5); // start past the silence
  expect(peaks.every((p) => p > 0)).toBe(true);
});

test('computePeaks handles empty / out-of-range input', () => {
  expect(computePeaks(new Float32Array(0), 0, 10)).toEqual([]);
  expect(computePeaks(new Float32Array(tone(10)), 100, 10)).toEqual([]);
  expect(computePeaks(new Float32Array(tone(10)), 0, 0)).toEqual([]);
});
