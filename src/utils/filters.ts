import type { Song, SongFilter } from '@/types';

export function matchSongFilter(song: Song, filter: SongFilter): boolean {
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
};
