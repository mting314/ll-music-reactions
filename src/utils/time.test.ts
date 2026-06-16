import { test, expect } from 'bun:test';
import { formatTime, parseTime } from './time';

test('formatTime shows m:ss.mmm', () => {
  expect(formatTime(0)).toBe('0:00.000');
  expect(formatTime(5)).toBe('0:05.000');
  expect(formatTime(83.456)).toBe('1:23.456');
  expect(formatTime(125.5)).toBe('2:05.500');
});

test('formatTime rounds to the nearest millisecond without splitting wrong', () => {
  expect(formatTime(12.9996)).toBe('0:13.000'); // not 0:12.1000
  expect(formatTime(59.9996)).toBe('1:00.000');
  expect(formatTime(1.2345)).toBe('0:01.235'); // Math.round(1234.5) → 1235
});

test('formatTime clamps negatives to zero', () => {
  expect(formatTime(-3)).toBe('0:00.000');
});

test('parseTime accepts m:ss.mmm', () => {
  expect(parseTime('1:23.456')).toBeCloseTo(83.456, 3);
  expect(parseTime('0:05')).toBe(5);
  expect(parseTime('2:00.5')).toBeCloseTo(120.5, 3);
});

test('parseTime accepts plain fractional seconds', () => {
  expect(parseTime('83.456')).toBeCloseTo(83.456, 3);
  expect(parseTime('5')).toBe(5);
});

test('parseTime returns null for blank/garbage', () => {
  expect(parseTime('')).toBeNull();
  expect(parseTime('   ')).toBeNull();
  expect(parseTime('abc')).toBeNull();
});

test('formatTime/parseTime round-trip preserves milliseconds', () => {
  for (const v of [0, 5, 83.456, 120.5, 7.001]) {
    expect(parseTime(formatTime(v))).toBeCloseTo(v, 3);
  }
});
