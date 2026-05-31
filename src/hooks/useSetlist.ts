import { useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Performance, TimelineEntry } from '@/types';
import { usePerformances, useSetlists } from './useData';

export function useSetlist() {
  const performances = usePerformances();
  const setlists = useSetlists();

  const performancesWithSetlists = useMemo(
    () => performances.filter((p) => p.hasSetlist),
    [performances],
  );

  const loadSetlist = (performanceId: string): TimelineEntry[] => {
    const setlist = setlists[performanceId];
    if (!setlist) return [];

    return setlist.items
      .filter((item) => item.type === 'song')
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        id: uuidv4(),
        clipId: null,
        songId: item.songId,
        songStartTime: null,
      }));
  };

  const searchPerformances = (query: string): Performance[] => {
    if (!query.trim()) return performancesWithSetlists.slice(0, 30);

    const q = query.toLowerCase();
    return performancesWithSetlists
      .filter(
        (p) =>
          p.tourName.toLowerCase().includes(q) ||
          p.venue.toLowerCase().includes(q) ||
          p.date.includes(q),
      )
      .slice(0, 30);
  };

  return { performancesWithSetlists, loadSetlist, searchPerformances };
}
