import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { TimelineEntry } from '@/types';

const STORAGE_KEY = 'll-music-reactions-projects';

export interface SavedProject {
  id: string;
  name: string;
  savedAt: string; // ISO timestamp
  entries: TimelineEntry[];
}

// ---- pure helpers (exported for testing) -----------------------------------

// Upsert by name (case-insensitive): re-saving an existing name overwrites it,
// otherwise the new project goes to the front (most-recent first).
export function upsertProject(
  list: SavedProject[],
  project: SavedProject,
): SavedProject[] {
  const key = project.name.trim().toLowerCase();
  const existing = list.find((p) => p.name.trim().toLowerCase() === key);
  if (existing) {
    return list.map((p) =>
      p.id === existing.id ? { ...project, id: existing.id } : p,
    );
  }
  return [project, ...list];
}

// Coerce an arbitrary parsed payload (a saved-project object, or a bare entries
// array) into a clean TimelineEntry[] — tolerant of imported files.
export function sanitizeEntries(raw: unknown): TimelineEntry[] {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { entries?: unknown })?.entries)
      ? (raw as { entries: unknown[] }).entries
      : null;
  if (!arr) return [];
  return arr.map((e) => {
    const o = (e ?? {}) as Partial<TimelineEntry>;
    return {
      id: typeof o.id === 'string' && o.id ? o.id : uuidv4(),
      clipId: typeof o.clipId === 'string' ? o.clipId : null,
      songId: typeof o.songId === 'string' ? o.songId : null,
      songStartTime: typeof o.songStartTime === 'number' ? o.songStartTime : null,
    };
  });
}

// ---- storage ---------------------------------------------------------------

function load(): SavedProject[] {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return JSON.parse(s) as SavedProject[];
  } catch {
    // ignore malformed/unavailable storage
  }
  return [];
}

function persist(projects: SavedProject[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // ignore (e.g. quota exceeded / storage disabled)
  }
}

export function useSavedProjects() {
  const [projects, setProjects] = useState<SavedProject[]>(load);

  const saveProject = useCallback((name: string, entries: TimelineEntry[]) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setProjects((prev) => {
      const project: SavedProject = {
        id: uuidv4(),
        name: trimmed,
        savedAt: new Date().toISOString(),
        // Deep-copy so later edits to the working timeline can't mutate the snapshot.
        entries: JSON.parse(JSON.stringify(entries)) as TimelineEntry[],
      };
      const next = upsertProject(prev, project);
      persist(next);
      return next;
    });
  }, []);

  const deleteProject = useCallback((id: string) => {
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== id);
      persist(next);
      return next;
    });
  }, []);

  return { projects, saveProject, deleteProject };
}
