import { test, expect, describe } from 'bun:test';
import { upsertProject, sanitizeEntries, type SavedProject } from './useSavedProjects';

const proj = (id: string, name: string): SavedProject => ({
  id,
  name,
  savedAt: '2026-01-01T00:00:00Z',
  entries: [],
});

describe('upsertProject', () => {
  test('adds a new project to the front (most-recent first)', () => {
    const out = upsertProject([proj('a', 'A')], proj('b', 'B'));
    expect(out.map((p) => p.name)).toEqual(['B', 'A']);
  });

  test('overwrites an existing name (case-insensitive), keeping id + position', () => {
    const list = [proj('a', 'Alpha'), proj('b', 'Beta')];
    const out = upsertProject(list, {
      id: 'new',
      name: 'ALPHA',
      savedAt: '2026-02-02T00:00:00Z',
      entries: [{ id: 'x', clipId: null, songId: 's', songStartTime: null }],
    });
    expect(out).toHaveLength(2);
    expect(out.map((p) => p.id)).toEqual(['a', 'b']); // order preserved
    const alpha = out.find((p) => p.id === 'a')!;
    expect(alpha.savedAt).toBe('2026-02-02T00:00:00Z'); // updated
    expect(alpha.entries).toHaveLength(1);
  });
});

describe('sanitizeEntries', () => {
  test('cleans a bare entries array', () => {
    expect(
      sanitizeEntries([{ id: '1', clipId: 'c', songId: 's', songStartTime: 5 }]),
    ).toEqual([{ id: '1', clipId: 'c', songId: 's', songStartTime: 5 }]);
  });

  test('reads entries from a saved-project object', () => {
    const out = sanitizeEntries({
      version: 1,
      entries: [{ id: '1', clipId: null, songId: null, songStartTime: null }],
    });
    expect(out).toHaveLength(1);
  });

  test('coerces missing/garbage fields and generates ids', () => {
    const out = sanitizeEntries([{}, { songId: 's' }]);
    expect(out).toHaveLength(2);
    expect(typeof out[0]!.id).toBe('string');
    expect(out[0]!.id.length).toBeGreaterThan(0);
    expect(out[0]!.clipId).toBeNull();
    expect(out[1]!.songId).toBe('s');
  });

  test('returns [] for non-array / garbage input', () => {
    expect(sanitizeEntries(null)).toEqual([]);
    expect(sanitizeEntries(42)).toEqual([]);
    expect(sanitizeEntries({})).toEqual([]);
  });
});
