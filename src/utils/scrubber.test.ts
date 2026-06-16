import { test, expect } from 'bun:test';
import { clamp, positionToTime, timeToPercent } from './scrubber';

test('clamp keeps values within range', () => {
  expect(clamp(5, 0, 10)).toBe(5);
  expect(clamp(-1, 0, 10)).toBe(0);
  expect(clamp(99, 0, 10)).toBe(10);
});

test('clamp tolerates an inverted range (hi < lo) by returning lo', () => {
  // happens transiently when the start marker is dragged past the duration
  expect(clamp(5, 10, 0)).toBe(10);
});

test('positionToTime maps pointer x across the track to [0, duration]', () => {
  // track spans clientX 100..300 (width 200), duration 60s
  expect(positionToTime(100, 100, 200, 60)).toBe(0);
  expect(positionToTime(200, 100, 200, 60)).toBe(30);
  expect(positionToTime(300, 100, 200, 60)).toBe(60);
});

test('positionToTime clamps pointer x outside the track', () => {
  expect(positionToTime(50, 100, 200, 60)).toBe(0); // left of track
  expect(positionToTime(400, 100, 200, 60)).toBe(60); // right of track
});

test('positionToTime is 0 for a zero-width track or zero-length audio', () => {
  expect(positionToTime(150, 100, 0, 60)).toBe(0);
  expect(positionToTime(150, 100, 200, 0)).toBe(0);
});

test('timeToPercent positions a handle as a percentage', () => {
  expect(timeToPercent(0, 60)).toBe(0);
  expect(timeToPercent(15, 60)).toBe(25);
  expect(timeToPercent(60, 60)).toBe(100);
  expect(timeToPercent(90, 60)).toBe(100); // clamped
  expect(timeToPercent(10, 0)).toBe(0); // no duration yet
});

test('playhead can never precede the start marker (clamp lower bound)', () => {
  const start = 12;
  const end = 60;
  // a seek/scrub before the marker is pulled up to the marker
  expect(clamp(5, start, end)).toBe(start);
  expect(clamp(30, start, end)).toBe(30);
});
