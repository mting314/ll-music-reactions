import { useState, useCallback, useRef } from 'react';
import { getAlbumArtUrl } from '@/hooks/useData';
import { getClipUrl } from '@/hooks/useClipLibrary';
import {
  getCachedSuggestedStart,
  resolveSuggestedStart,
} from '@/utils/audioAnalysis';
import { exportVideoClientSide } from '@/utils/clientExport';
import type { TimelineEntry, Song, Discography, ExportSettings, ReactionClip } from '@/types';
import clipManifest from '@/data/clips-manifest.json';

const clips = clipManifest as ReactionClip[];

// Phases reported during client-side export.
export type ExportPhase =
  | 'analyzing'
  | 'assets'
  | 'encoding'
  | 'finalizing';

export interface ExportStatus {
  phase: ExportPhase;
  entryCount: number;
  resolution: ExportSettings['resolution'];
  // analyzing / assets phase: 1-based item index & total.
  assetIndex: number;
  assetTotal: number;
  // encoding phase: 0..99 percent.
  encodePct: number | null;
}

export function useVideoExport() {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ExportStatus | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      setStatus({
        phase: 'assets',
        entryCount: validEntries.length,
        resolution: settings.resolution,
        assetIndex: 0,
        assetTotal: validEntries.length,
        encodePct: null,
      });

      // Live elapsed-time ticker so the panel never looks frozen.
      const startedAt = Date.now();
      setElapsedMs(0);
      timerRef.current = setInterval(
        () => setElapsedMs(Date.now() - startedAt),
        500,
      );

      try {
        // Resolve auto-detected chorus start times for any entries still on Auto
        // (songStartTime == null) that haven't been analyzed yet (e.g. off-screen
        // rows in a long setlist). Dedup by URL and run with concurrency 4.
        const uncachedUrls = Array.from(
          new Set(
            validEntries
              .filter((e) => e.songStartTime == null)
              .map((e) => (e.songId ? songMap.get(e.songId)?.wikiAudioUrl : null))
              .filter(
                (url): url is string =>
                  !!url && getCachedSuggestedStart(url) == null,
              ),
          ),
        );

        const resolvedByUrl = new Map<string, number>();
        if (uncachedUrls.length > 0) {
          let doneCount = 0;
          setStatus({
            phase: 'analyzing',
            entryCount: validEntries.length,
            resolution: settings.resolution,
            assetIndex: 0,
            assetTotal: uncachedUrls.length,
            encodePct: null,
          });

          const CONCURRENCY = 4;
          let cursor = 0;
          const worker = async () => {
            while (cursor < uncachedUrls.length) {
              const url = uncachedUrls[cursor++]!;
              const startSec = await resolveSuggestedStart(url);
              resolvedByUrl.set(url, startSec);
              doneCount++;
              setStatus((s) =>
                s
                  ? {
                      ...s,
                      phase: 'analyzing',
                      assetIndex: doneCount,
                      assetTotal: uncachedUrls.length,
                    }
                  : s,
              );
            }
          };
          await Promise.all(
            Array.from(
              { length: Math.min(CONCURRENCY, uncachedUrls.length) },
              worker,
            ),
          );
        }

        const exportEntries = validEntries.map((entry) => {
          const clip = clips.find((c) => c.id === entry.clipId);
          if (!clip) {
            throw new Error(`Reaction clip "${entry.clipId}" is no longer available`);
          }
          const song = entry.songId ? songMap.get(entry.songId) : null;
          const artUrl = song ? getAlbumArtUrl(song, discographyMap) : null;
          const audioUrl = song?.wikiAudioUrl ?? null;
          const startTime =
            entry.songStartTime ??
            (audioUrl
              ? (resolvedByUrl.get(audioUrl) ??
                getCachedSuggestedStart(audioUrl) ??
                0)
              : 0);

          return {
            clipUrl: getClipUrl(clip),
            durationMs: clip.durationMs,
            albumArtUrl: artUrl,
            songAudioUrl: audioUrl,
            songStartTime: startTime,
            songName: song?.name ?? 'Unknown',
          };
        });

        setStatus({
          phase: 'assets',
          entryCount: exportEntries.length,
          resolution: settings.resolution,
          assetIndex: 0,
          assetTotal: exportEntries.length,
          encodePct: null,
        });

        const blob = await exportVideoClientSide({
          entries: exportEntries,
          resolution: settings.resolution,
          overlayPosition: settings.overlayPosition,
          onAssetProgress: (assetIndex, assetTotal) =>
            setStatus((s) =>
              s ? { ...s, phase: 'assets', assetIndex, assetTotal } : s,
            ),
          onEncodeProgress: (encodePct) =>
            setStatus((s) =>
              s ? { ...s, phase: 'encoding', encodePct } : s,
            ),
          onFinalizing: () =>
            setStatus((s) => (s ? { ...s, phase: 'finalizing' } : s)),
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'll-music-reactions.mp4';
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Export failed');
      } finally {
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        setIsExporting(false);
        setStatus(null);
      }
    },
    [],
  );

  return {
    isExporting,
    error,
    status,
    elapsedMs,
    startExport,
  };
}
