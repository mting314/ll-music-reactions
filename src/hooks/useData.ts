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

import songData from '@/data/song-info.json';
import artistData from '@/data/artists-info.json';
import discographyData from '@/data/discography-info.json';
import seriesInfoData from '@/data/series-info.json';
import seriesNameData from '@/data/series.json';
import performanceData from '@/data/performance-info.json';
import setlistData from '@/data/performance-setlists.json';
import clipManifest from '@/data/clips-manifest.json';

export function useSongs(): Song[] {
  return songData as Song[];
}

export function useArtists(): Artist[] {
  return artistData as Artist[];
}

export function useArtistMap(): Map<string, Artist> {
  return useMemo(() => {
    const map = new Map<string, Artist>();
    for (const artist of artistData as Artist[]) {
      map.set(artist.id, artist);
    }
    return map;
  }, []);
}

export function useDiscography(): Discography[] {
  return discographyData as Discography[];
}

export function useDiscographyMap(): Map<string, Discography> {
  return useMemo(() => {
    const map = new Map<string, Discography>();
    for (const disc of discographyData as Discography[]) {
      map.set(disc.id, disc);
    }
    return map;
  }, []);
}

export function useSeries(): Series[] {
  const names = seriesNameData as Record<string, string>;
  return useMemo(() => {
    return (seriesInfoData as { id: string; name: string; color: string }[]).map(
      (s) => ({
        id: Number(s.id),
        name: s.name,
        englishName: names[s.name] ?? s.name,
        color: s.color,
      }),
    );
  }, [names]);
}

export function usePerformances(): Performance[] {
  return performanceData as Performance[];
}

export function useSetlists(): Record<string, Setlist> {
  return setlistData as unknown as Record<string, Setlist>;
}

export function useClips(): ReactionClip[] {
  return clipManifest as ReactionClip[];
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
