import { useMemo } from 'react';
import type {
  Song,
  Artist,
  Discography,
  Series,
  Performance,
  Setlist,
  ReactionClip,
} from '@/types';
import { useDataset } from '@/context/DataProvider';
import type { BuildInfo } from '@/data/dataset';
import clipManifest from '@/data/clips-manifest.json';

// Song/artist/discography/series/performance data comes from the Dataset
// (fetched from the DB-backed API at runtime) via DataProvider. Reaction clips
// remain bundled — they're our own assets, not external catalog data.

export function useSongs(): Song[] {
  return useDataset().songs;
}

export function useArtists(): Artist[] {
  return useDataset().artists;
}

export function useArtistMap(): Map<string, Artist> {
  const artists = useDataset().artists;
  return useMemo(() => {
    const map = new Map<string, Artist>();
    for (const artist of artists) {
      map.set(artist.id, artist);
    }
    return map;
  }, [artists]);
}

export function useDiscography(): Discography[] {
  return useDataset().discographies;
}

export function useDiscographyMap(): Map<string, Discography> {
  const discographies = useDataset().discographies;
  return useMemo(() => {
    const map = new Map<string, Discography>();
    for (const disc of discographies) {
      map.set(disc.id, disc);
    }
    return map;
  }, [discographies]);
}

export function useSeries(): Series[] {
  const { seriesInfo, seriesNames } = useDataset();
  return useMemo(() => {
    return seriesInfo.map((s) => ({
      id: Number(s.id),
      name: s.name,
      englishName: seriesNames[s.name] ?? s.name,
      color: s.color,
    }));
  }, [seriesInfo, seriesNames]);
}

export function usePerformances(): Performance[] {
  return useDataset().performances;
}

export function useSetlists(): Record<string, Setlist> {
  return useDataset().setlists;
}

export function useClips(): ReactionClip[] {
  return clipManifest as ReactionClip[];
}

// Provenance of the loaded dataset (when it was last refreshed). Null when the
// payload carries no build info.
export function useBuildInfo(): BuildInfo | null {
  return useDataset().build;
}

export function getAlbumArtUrl(
  song: Song,
  discographyMap: Map<string, Discography>,
): string | null {
  const firstDiscId = song.discographyIds?.[0];
  if (firstDiscId == null) return null;
  const disc = discographyMap.get(String(firstDiscId));
  if (!disc) return null;
  const imageUrl = disc.versions?.[0]?.imageUrl;
  return imageUrl ?? null;
}
