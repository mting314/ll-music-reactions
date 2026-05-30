import { useState, useMemo } from 'react';
import type { Song, SongFilter } from '@/types';
import { fuzzySearch, getSearchScore } from '@/utils/search';
import { matchSongFilter, EMPTY_FILTER } from '@/utils/filters';

const MAX_RESULTS = 50;

export function useSongSearch(songs: Song[]) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SongFilter>(EMPTY_FILTER);

  const results = useMemo(() => {
    let filtered = songs;

    const hasFilter =
      filter.series.length > 0 ||
      filter.artists.length > 0 ||
      filter.years.length > 0;

    if (hasFilter) {
      filtered = filtered.filter((s) => matchSongFilter(s, filter));
    }

    if (!query.trim()) {
      return filtered.slice(0, MAX_RESULTS);
    }

    return filtered
      .filter((s) => fuzzySearch(s, query))
      .map((s) => ({ song: s, score: getSearchScore(s, query) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((r) => r.song);
  }, [songs, query, filter]);

  return { query, setQuery, filter, setFilter, results };
}
