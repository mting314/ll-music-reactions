import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { TimelineEntry } from '@/types';

const STORAGE_KEY = 'll-music-reactions-timeline';

function loadFromStorage(): TimelineEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as TimelineEntry[];
  } catch {
    // ignore
  }
  return [];
}

function saveToStorage(entries: TimelineEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function useTimeline() {
  const [entries, setEntries] = useState<TimelineEntry[]>(loadFromStorage);

  const persist = useCallback((next: TimelineEntry[]) => {
    setEntries(next);
    saveToStorage(next);
  }, []);

  const addEntry = useCallback(
    (clipId: string | null = null, songId: string | null = null) => {
      persist([...entries, { id: uuidv4(), clipId, songId }]);
    },
    [entries, persist],
  );

  const removeEntry = useCallback(
    (entryId: string) => {
      persist(entries.filter((e) => e.id !== entryId));
    },
    [entries, persist],
  );

  const updateEntry = useCallback(
    (entryId: string, updates: Partial<Pick<TimelineEntry, 'clipId' | 'songId'>>) => {
      persist(
        entries.map((e) => (e.id === entryId ? { ...e, ...updates } : e)),
      );
    },
    [entries, persist],
  );

  const reorderEntries = useCallback(
    (fromIndex: number, toIndex: number) => {
      const next = [...entries];
      const [moved] = next.splice(fromIndex, 1);
      if (moved) {
        next.splice(toIndex, 0, moved);
        persist(next);
      }
    },
    [entries, persist],
  );

  const clearTimeline = useCallback(() => {
    persist([]);
  }, [persist]);

  const loadEntries = useCallback(
    (newEntries: TimelineEntry[]) => {
      persist(newEntries);
    },
    [persist],
  );

  return {
    entries,
    addEntry,
    removeEntry,
    updateEntry,
    reorderEntries,
    clearTimeline,
    loadEntries,
  };
}
