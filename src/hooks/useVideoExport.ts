import { useState, useCallback } from 'react';
import { exportVideo } from '@/utils/ffmpeg';
import { getAlbumArtUrl } from '@/hooks/useData';
import { getClipUrl } from '@/hooks/useClipLibrary';
import type { TimelineEntry, Song, Discography, ExportSettings } from '@/types';
import clipManifest from '@/data/clips-manifest.json';
import type { ReactionClip } from '@/types';

const clips = clipManifest as ReactionClip[];

export function useVideoExport() {
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);

  const startExport = useCallback(
    async (
      entries: TimelineEntry[],
      songMap: Map<string, Song>,
      discographyMap: Map<string, Discography>,
      settings: ExportSettings,
    ) => {
      setIsExporting(true);
      setProgress(0);
      setError(null);
      setResultUrl(null);

      try {
        const validEntries = entries.filter((e) => e.clipId && e.songId);
        if (validEntries.length === 0) {
          throw new Error('No complete entries to export');
        }

        const exportEntries = validEntries.map((entry) => {
          const clip = clips.find((c) => c.id === entry.clipId);
          if (!clip) throw new Error(`Clip ${entry.clipId} not found`);

          const song = entry.songId ? songMap.get(entry.songId) : null;
          const artUrl = song ? getAlbumArtUrl(song, discographyMap) : null;

          return {
            clipUrl: getClipUrl(clip),
            albumArtUrl: artUrl,
          };
        });

        const blob = await exportVideo(
          exportEntries,
          settings.overlayPosition,
          settings.resolution,
          setProgress,
        );

        const url = URL.createObjectURL(blob);
        setResultUrl(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Export failed');
      } finally {
        setIsExporting(false);
      }
    },
    [],
  );

  const downloadResult = useCallback(() => {
    if (!resultUrl) return;
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = 'll-music-reactions.mp4';
    a.click();
  }, [resultUrl]);

  return {
    isExporting,
    progress,
    error,
    resultUrl,
    startExport,
    downloadResult,
  };
}
