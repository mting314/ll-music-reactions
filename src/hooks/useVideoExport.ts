import { useState, useCallback } from 'react';
import { getAlbumArtUrl } from '@/hooks/useData';
import type { TimelineEntry, Song, Discography, ExportSettings } from '@/types';
import clipManifest from '@/data/clips-manifest.json';
import type { ReactionClip } from '@/types';

const clips = clipManifest as ReactionClip[];
const EXPORT_API = 'http://localhost:3001/export';

export function useVideoExport() {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startExport = useCallback(
    async (
      entries: TimelineEntry[],
      songMap: Map<string, Song>,
      discographyMap: Map<string, Discography>,
      settings: ExportSettings,
    ) => {
      const validEntries = entries.filter((e) => e.clipId && e.songId);
      if (validEntries.length === 0) return;

      setIsExporting(true);
      setError(null);

      try {
        const exportEntries = validEntries.map((entry) => {
          const clip = clips.find((c) => c.id === entry.clipId)!;
          const song = entry.songId ? songMap.get(entry.songId) : null;
          const artUrl = song ? getAlbumArtUrl(song, discographyMap) : null;

          return {
            clipPath: clip.filename,
            albumArtUrl: artUrl,
            songAudioUrl: song?.wikiAudioUrl ?? null,
            songStartTime: entry.songStartTime ?? 0,
            songName: song?.name ?? 'Unknown',
            clipName: clip.name,
          };
        });

        const resp = await fetch(EXPORT_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            entries: exportEntries,
            resolution: settings.resolution,
            overlayPosition: settings.overlayPosition,
          }),
        });

        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(body.error || `Server error ${resp.status}`);
        }

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'll-music-reactions.mp4';
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Export failed');
      } finally {
        setIsExporting(false);
      }
    },
    [],
  );

  return {
    isExporting,
    error,
    startExport,
  };
}
