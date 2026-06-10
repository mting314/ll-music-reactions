import { test, expect, describe } from 'bun:test';
import { matchSongFilter, getSongTypes, EMPTY_FILTER } from './filters';
import type { Artist, Song } from '@/types';

const artist = (id: string, name: string, characters: string[]): Artist => ({
  id,
  name,
  seriesIds: [1],
  characters,
});

const artistMap = new Map<string, Artist>([
  // 9 characters + a main-group name → "group"
  ['1', artist('1', "μ's", ['1', '2', '3', '4', '5', '6', '7', '8', '9'])],
  // multi-character but not a main group → "unit" (subunit)
  ['3', artist('3', 'lily white', ['4', '5', '7'])],
  // single character → "solo"
  ['10', artist('10', 'Kousaka Honoka', ['1'])],
]);

const song = (over: Partial<Song>): Song =>
  ({
    id: 's',
    name: 'name',
    phoneticName: '',
    englishName: '',
    seriesIds: [1],
    releasedOn: '2015-01-01',
    artists: [],
    discographyIds: [],
    ...over,
  }) as Song;

const f = (over: Partial<typeof EMPTY_FILTER>) => ({ ...EMPTY_FILTER, ...over });

describe('getSongTypes', () => {
  test('classifies group / unit / solo by artist', () => {
    expect(getSongTypes(song({ artists: [{ id: '1', variant: null }] }), artistMap)).toEqual(
      new Set(['group']),
    );
    expect(getSongTypes(song({ artists: [{ id: '3', variant: null }] }), artistMap)).toEqual(
      new Set(['unit']),
    );
    expect(getSongTypes(song({ artists: [{ id: '10', variant: null }] }), artistMap)).toEqual(
      new Set(['solo']),
    );
  });
});

describe('matchSongFilter — type', () => {
  const groupSong = song({ artists: [{ id: '1', variant: null }] });

  test('matches the selected type, rejects others', () => {
    expect(matchSongFilter(groupSong, f({ types: ['group'] }), artistMap)).toBe(true);
    expect(matchSongFilter(groupSong, f({ types: ['solo'] }), artistMap)).toBe(false);
    // OR within the type section
    expect(matchSongFilter(groupSong, f({ types: ['solo', 'group'] }), artistMap)).toBe(true);
  });
});

describe('matchSongFilter — series / artist / year', () => {
  const s = song({
    seriesIds: [1],
    artists: [{ id: '3', variant: null }],
    releasedOn: '2015-06-01',
  });

  test('series', () => {
    expect(matchSongFilter(s, f({ series: [1] }), artistMap)).toBe(true);
    expect(matchSongFilter(s, f({ series: [2] }), artistMap)).toBe(false);
  });
  test('artist', () => {
    expect(matchSongFilter(s, f({ artists: ['3'] }), artistMap)).toBe(true);
    expect(matchSongFilter(s, f({ artists: ['1'] }), artistMap)).toBe(false);
  });
  test('year', () => {
    expect(matchSongFilter(s, f({ years: [2015] }), artistMap)).toBe(true);
    expect(matchSongFilter(s, f({ years: [2016] }), artistMap)).toBe(false);
  });
});

describe('matchSongFilter — AND across sections', () => {
  test('all active sections must match', () => {
    const s = song({
      seriesIds: [1],
      artists: [{ id: '3', variant: null }],
      releasedOn: '2015-06-01',
    });
    // series matches but type doesn't → false
    expect(matchSongFilter(s, f({ series: [1], types: ['solo'] }), artistMap)).toBe(false);
    // both match → true
    expect(matchSongFilter(s, f({ series: [1], types: ['unit'] }), artistMap)).toBe(true);
  });

  test('empty filter matches everything', () => {
    expect(matchSongFilter(song({}), EMPTY_FILTER, artistMap)).toBe(true);
  });
});
