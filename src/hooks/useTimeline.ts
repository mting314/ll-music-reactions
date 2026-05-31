import { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { TimelineEntry } from '@/types';

const STORAGE_KEY = 'll-music-reactions-timeline';
const MAX_HISTORY = 50;

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
  const historyRef = useRef<TimelineEntry[][]>([]);
  const redoRef = useRef<TimelineEntry[][]>([]);

  const persist = useCallback((next: TimelineEntry[]) => {
    setEntries((prev) => {
      historyRef.current = [...historyRef.current.slice(-MAX_HISTORY), prev];
      redoRef.current = [];
      return next;
    });
    saveToStorage(next);
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (prev === undefined) return;
    setEntries((current) => {
      redoRef.current.push(current);
      saveToStorage(prev);
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (next === undefined) return;
    setEntries((current) => {
      historyRef.current.push(current);
      saveToStorage(next);
      return next;
    });
  }, []);

  const canUndo = historyRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;

  const addEntry = useCallback(
    (clipId: string | null = null, songId: string | null = null) => {
      setEntries((prev) => {
        const next = [...prev, { id: uuidv4(), clipId, songId, songStartTime: null }];
        historyRef.current = [...historyRef.current.slice(-MAX_HISTORY), prev];
        redoRef.current = [];
        saveToStorage(next);
        return next;
      });
    },
    [],
  );

  const removeEntry = useCallback((entryId: string) => {
    setEntries((prev) => {
      const next = prev.filter((e) => e.id !== entryId);
      historyRef.current = [...historyRef.current.slice(-MAX_HISTORY), prev];
      redoRef.current = [];
      saveToStorage(next);
      return next;
    });
  }, []);

  const updateEntry = useCallback(
    (entryId: string, updates: Partial<Pick<TimelineEntry, 'clipId' | 'songId' | 'songStartTime'>>) => {
      setEntries((prev) => {
        const next = prev.map((e) => (e.id === entryId ? { ...e, ...updates } : e));
        historyRef.current = [...historyRef.current.slice(-MAX_HISTORY), prev];
        redoRef.current = [];
        saveToStorage(next);
        return next;
      });
    },
    [],
  );

  const reorderEntries = useCallback((fromIndex: number, toIndex: number) => {
    setEntries((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      if (moved) {
        next.splice(toIndex, 0, moved);
        historyRef.current = [...historyRef.current.slice(-MAX_HISTORY), prev];
        redoRef.current = [];
        saveToStorage(next);
        return next;
      }
      return prev;
    });
  }, []);

  const clearTimeline = useCallback(() => {
    setEntries((prev) => {
      historyRef.current = [...historyRef.current.slice(-MAX_HISTORY), prev];
      redoRef.current = [];
      saveToStorage([]);
      return [];
    });
  }, []);

  const loadEntries = useCallback((newEntries: TimelineEntry[]) => {
    setEntries((prev) => {
      historyRef.current = [...historyRef.current.slice(-MAX_HISTORY), prev];
      redoRef.current = [];
      saveToStorage(newEntries);
      return newEntries;
    });
  }, []);

  return {
    entries,
    addEntry,
    removeEntry,
    updateEntry,
    reorderEntries,
    clearTimeline,
    loadEntries,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}
