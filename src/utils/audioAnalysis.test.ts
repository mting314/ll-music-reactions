import { expect, test, describe } from 'bun:test';
import {
  readAutoStartCache,
  writeAutoStartEntry,
  type StoredAutoStart,
} from './audioAnalysis';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    dump: () => Object.fromEntries(map.entries()),
  };
}

describe('auto-start localStorage cache', () => {
  test('reads valid entries and skips malformed entries safely', () => {
    const storage = memoryStorage({
      'll-music-reactions-auto-starts-v1': JSON.stringify({
        'https://example.com/a.ogg': { leadIn: 0.5, suggestedStart: 54.25 },
        'https://example.com/bad1.ogg': { leadIn: 'oops', suggestedStart: 10 },
        'https://example.com/bad2.ogg': null,
      }),
    });

    expect(readAutoStartCache(storage)).toEqual({
      'https://example.com/a.ogg': { leadIn: 0.5, suggestedStart: 54.25 },
    });
  });

  test('returns empty object for corrupt JSON or unavailable storage', () => {
    expect(readAutoStartCache(null)).toEqual({});
    expect(
      readAutoStartCache(
        memoryStorage({ 'll-music-reactions-auto-starts-v1': '{not json' }),
      ),
    ).toEqual({});
  });

  test('writeAutoStartEntry updates LRU order and enforces maxEntries cap', () => {
    const storage = memoryStorage();
    let cache: Record<string, StoredAutoStart> = {};

    cache = writeAutoStartEntry(cache, 'u1', { leadIn: 0, suggestedStart: 10 }, 2, storage);
    cache = writeAutoStartEntry(cache, 'u2', { leadIn: 0, suggestedStart: 20 }, 2, storage);
    // Touch u1 so u2 becomes oldest
    cache = writeAutoStartEntry(cache, 'u1', { leadIn: 0, suggestedStart: 11 }, 2, storage);
    // Insert u3 -> evicts u2, keeps u1 and u3
    cache = writeAutoStartEntry(cache, 'u3', { leadIn: 0, suggestedStart: 30 }, 2, storage);

    expect(Object.keys(cache)).toEqual(['u1', 'u3']);
    expect(cache.u1?.suggestedStart).toBe(11);
    expect(readAutoStartCache(storage)).toEqual(cache);
  });
});
