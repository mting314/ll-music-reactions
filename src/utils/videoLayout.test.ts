import { expect, test, describe } from 'bun:test';
import {
  computeCoverCrop,
  computeOverlayRects,
  exportDimensions,
  formatSongLabel,
  sliceStereoPcm,
} from './videoLayout';

describe('exportDimensions', () => {
  test('maps 720p to 720 and 480p to 480 (1:1 square)', () => {
    expect(exportDimensions('720p')).toBe(720);
    expect(exportDimensions('480p')).toBe(480);
  });
});

describe('computeCoverCrop', () => {
  test('center-crops landscape input to a centered square', () => {
    expect(computeCoverCrop(1280, 720)).toEqual({
      sx: 280,
      sy: 0,
      sw: 720,
      sh: 720,
    });
  });

  test('center-crops portrait input to a centered square', () => {
    expect(computeCoverCrop(960, 1152)).toEqual({
      sx: 0,
      sy: 96,
      sw: 960,
      sh: 960,
    });
  });

  test('passes 1:1 square through untouched', () => {
    expect(computeCoverCrop(720, 720)).toEqual({
      sx: 0,
      sy: 0,
      sw: 720,
      sh: 720,
    });
  });
});

describe('formatSongLabel', () => {
  test('keeps short and medium English/Japanese titles on one line without orphan wrap', () => {
    expect(formatSongLabel('Snow halation')).toEqual(['Snow halation']);
    expect(formatSongLabel('ユメノトビラ')).toEqual(['ユメノトビラ']);
    expect(formatSongLabel('届かない星だとしても')).toEqual([
      '届かない星だとしても',
    ]);
  });

  test('wraps longer titles evenly around the midpoint (no hanging orphan character)', () => {
    expect(formatSongLabel('SUPER SUMMER SENSATION!!')).toEqual([
      'SUPER SUMMER',
      'SENSATION!!',
    ]);
    expect(formatSongLabel('君のこころは輝いてるかい？')).toEqual([
      '君のこころは',
      '輝いてるかい？',
    ]);
  });

  test('truncates very long titles on line 2 with an ellipsis', () => {
    const lines = formatSongLabel(
      'Colorful Dreams! Colorful Smiles! (Special Remix)',
    );
    expect(lines.length).toBe(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
  });

  test('returns empty array for blank input', () => {
    expect(formatSongLabel('   ')).toEqual([]);
  });
});

describe('computeOverlayRects', () => {
  test('top-right places art in corner and label directly beneath', () => {
    const r = computeOverlayRects('top-right', '720p', 1);
    expect(r.artX).toBe(520);
    expect(r.artY).toBe(20);
    expect(r.labelCenterX).toBe(610);
    expect(r.labelTopY).toBe(206);
  });

  test('bottom-right lifts art so a 2-line label fits cleanly below inside the frame', () => {
    const r = computeOverlayRects('bottom-right', '720p', 2);
    // labelBlockHeight = gap(6) + 2*lineHeight(40) + 2*boxPadY(8) = 54
    expect(r.artY).toBe(720 - 180 - 20 - 54);
    expect(r.labelTopY).toBe(r.artY + 180 + 6);
    // Bottom of label box sits at 720 - margin(20)
    expect(r.labelTopY + 40 + 8).toBe(700);
  });
});

describe('sliceStereoPcm', () => {
  test('slices exact window, duplicates mono to stereo, and fades edges', () => {
    const sr = 1000;
    const mono = new Float32Array(3000).fill(1.0);
    const [l, r] = sliceStereoPcm([mono], sr, 0.5, 1.0, sr, 0.01);

    expect(l.length).toBe(1000);
    expect(r.length).toBe(1000);
    // Edge fade starts at 0 and reaches 1 in the middle
    expect(l[0]).toBe(0);
    expect(l[500]).toBeCloseTo(1.0, 5);
    expect(r[500]).toBeCloseTo(1.0, 5);
    expect(l[999]).toBe(0);
  });

  test('resamples linearly when source and target sample rates differ', () => {
    const src = new Float32Array(4800).fill(0.5); // 0.1s at 48kHz
    const [l] = sliceStereoPcm([src], 48000, 0, 0.1, 44100, 0);
    expect(l.length).toBe(4410);
    expect(l[2000]).toBeCloseTo(0.5, 4);
  });

  test('returns silence when channels are empty or start is past end', () => {
    const [l1, r1] = sliceStereoPcm([], 44100, 0, 0.5, 44100);
    expect(l1.length).toBe(22050);
    expect(l1[100]).toBe(0);
    expect(r1[100]).toBe(0);

    const short = new Float32Array(100).fill(1);
    const [l2] = sliceStereoPcm([short], 100, 5, 0.5, 100);
    expect(l2[0]).toBe(0);
    expect(l2[25]).toBe(0);
  });
});
