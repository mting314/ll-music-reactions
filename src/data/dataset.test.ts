import { test, expect, describe } from 'bun:test';
import { toDataset } from './dataset';

describe('toDataset', () => {
  test('passes a full payload through', () => {
    const d = toDataset({
      songs: [{ id: '1' }],
      artists: [{ id: 'a' }],
      discographies: [{ id: 'd' }],
      seriesInfo: [{ id: 's', name: 'S', color: '#fff' }],
      seriesNames: { S: 'Series' },
      performances: [{ id: 'p' }],
      setlists: { p: { foo: 1 } },
      build: { generatedAt: '2026-06-09T00:00:00Z', counts: { songs: 1 } },
    });
    expect(d.songs).toHaveLength(1);
    expect(d.seriesNames).toEqual({ S: 'Series' });
    expect(d.setlists).toEqual({ p: { foo: 1 } });
    expect(d.build?.generatedAt).toBe('2026-06-09T00:00:00Z');
  });

  test('defaults missing fields to empty', () => {
    const d = toDataset({ songs: [{ id: '1' }] });
    expect(d.artists).toEqual([]);
    expect(d.discographies).toEqual([]);
    expect(d.seriesInfo).toEqual([]);
    expect(d.performances).toEqual([]);
    expect(d.seriesNames).toEqual({});
    expect(d.setlists).toEqual({});
    expect(d.build).toBeNull();
  });

  test('handles null / undefined / non-object input without throwing', () => {
    expect(toDataset(null).songs).toEqual([]);
    expect(toDataset(undefined).songs).toEqual([]);
    expect(toDataset(42).songs).toEqual([]);
    expect(toDataset('nope').build).toBeNull();
  });
});
