import type { Song, Artist, Discography, Performance, Setlist } from '@/types';

export interface SeriesInfo {
  id: string;
  name: string;
  color: string;
}

// Provenance of the dataset, stamped by the daily refresh job
// (pipeline/run-refresh.ts) and carried through the /data payload.
export interface BuildInfo {
  generatedAt?: string;
  counts?: Record<string, number>;
}

// The full dataset the app needs. Fetched from the data API (DB-backed) at
// runtime — there is no bundled copy. If the API is unreachable the app shows
// an error rather than stale data (see src/context/DataProvider.tsx).
export interface Dataset {
  songs: Song[];
  artists: Artist[];
  discographies: Discography[];
  seriesInfo: SeriesInfo[];
  seriesNames: Record<string, string>;
  performances: Performance[];
  setlists: Record<string, Setlist>;
  build: BuildInfo | null;
}

// Coerce the /data API payload into a Dataset, defaulting any missing field to
// empty so a partial payload can't crash consumers.
export function toDataset(raw: unknown): Dataset {
  const d = (raw ?? {}) as Partial<Dataset>;
  return {
    songs: d.songs ?? [],
    artists: d.artists ?? [],
    discographies: d.discographies ?? [],
    seriesInfo: d.seriesInfo ?? [],
    seriesNames: d.seriesNames ?? {},
    performances: d.performances ?? [],
    setlists: d.setlists ?? {},
    build: d.build ?? null,
  };
}
