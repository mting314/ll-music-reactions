import { test, expect } from 'bun:test';
import { detectLeadIn } from './audio';

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
