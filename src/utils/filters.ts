import type { Artist, Song, SongFilter, SongType } from '@/types';

// Main-group artist names (à la the-sorter's GROUPS_INFO): a song performed by
// one of these is a "group" song; a single-character artist is "solo"; anything
// else multi-character is a "unit" (subunit). Ported from
// hamproductions/the-sorter so our Type filter matches theirs.
const GROUP_NAMES = new Set<string>([
  "μ's",
  'Aqours',
  'Aqours feat. 初音ミク',
  'Saint Aqours Snow',
  '私立浦の星女学院一同',
  'シャゼリア☆キッス',
  '虹ヶ咲学園スクールアイドル同好会',
  'ニジガク with You',
  'Liella!',
  '椿滝桜女学院高等学校スクールアイドル部!',
  '蓮ノ空女学院スクールアイドルクラブ',
  'スリーズブーケ＆DOLLCHESTRA＆みらくらぱーく！',
]);

// Classify a single artist as solo / group / unit.
function artistType(artist: Artist): SongType {
  if (GROUP_NAMES.has(artist.name)) return 'group';
  if ((artist.characters?.length ?? 0) <= 1) return 'solo';
  return 'unit';
}

// All the types represented among a song's performing artists.
export function getSongTypes(
  song: Song,
  artists: Map<string, Artist>,
): Set<SongType> {
  const types = new Set<SongType>();
  for (const ref of song.artists) {
    const artist = artists.get(ref.id);
    if (artist) types.add(artistType(artist));
  }
  return types;
}

export function matchSongFilter(
  song: Song,
  filter: SongFilter,
  artists?: Map<string, Artist>,
): boolean {
  if (
    filter.series.length > 0 &&
    !song.seriesIds.some((id) => filter.series.includes(id))
  ) {
    return false;
  }

  if (
    filter.artists.length > 0 &&
    !song.artists.some((a) => filter.artists.includes(a.id))
  ) {
    return false;
  }

  if (filter.years.length > 0) {
    const songYear = new Date(song.releasedOn).getFullYear();
    if (!filter.years.includes(songYear)) {
      return false;
    }
  }

  if (filter.types.length > 0 && artists) {
    const songTypes = getSongTypes(song, artists);
    if (!filter.types.some((t) => songTypes.has(t))) {
      return false;
    }
  }

  return true;
}

export function getAvailableYears(songs: Song[]): number[] {
  const years = new Set<number>();
  for (const song of songs) {
    if (song.releasedOn) {
      years.add(new Date(song.releasedOn).getFullYear());
    }
  }
  return Array.from(years).sort((a, b) => b - a);
}

export const EMPTY_FILTER: SongFilter = {
  series: [],
  artists: [],
  years: [],
  types: [],
};
