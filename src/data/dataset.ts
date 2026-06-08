import type { Song, Artist, Discography, Performance, Setlist } from '@/types';

import songData from '@/data/song-info.json';
import artistData from '@/data/artists-info.json';
import discographyData from '@/data/discography-info.json';
import seriesInfoData from '@/data/series-info.json';
import seriesNameData from '@/data/series.json';
import performanceData from '@/data/performance-info.json';
import setlistData from '@/data/performance-setlists.json';

export interface SeriesInfo {
  id: string;
  name: string;
  color: string;
}

// The full dataset the app needs, sourced either from the data API (DB-backed)
// or the bundled JSON snapshot below as a fallback.
export interface Dataset {
  songs: Song[];
  artists: Artist[];
  discographies: Discography[];
  seriesInfo: SeriesInfo[];
  seriesNames: Record<string, string>;
  performances: Performance[];
  setlists: Record<string, Setlist>;
}

// Bundled snapshot (the committed src/data JSON). Used when VITE_DATA_API is
// unset or the API is unreachable, so the app always works.
export const bundledDataset: Dataset = {
  songs: songData as Song[],
  artists: artistData as Artist[],
  discographies: discographyData as Discography[],
  seriesInfo: seriesInfoData as SeriesInfo[],
  seriesNames: seriesNameData as Record<string, string>,
  performances: performanceData as Performance[],
  setlists: setlistData as unknown as Record<string, Setlist>,
};

// Coerce an arbitrary /data API payload into a Dataset, falling back to the
// bundled values for any missing field.
export function toDataset(raw: unknown): Dataset {
  const d = (raw ?? {}) as Partial<Dataset>;
  return {
    songs: d.songs ?? bundledDataset.songs,
    artists: d.artists ?? bundledDataset.artists,
    discographies: d.discographies ?? bundledDataset.discographies,
    seriesInfo: d.seriesInfo ?? bundledDataset.seriesInfo,
    seriesNames: d.seriesNames ?? bundledDataset.seriesNames,
    performances: d.performances ?? bundledDataset.performances,
    setlists: d.setlists ?? bundledDataset.setlists,
  };
}
