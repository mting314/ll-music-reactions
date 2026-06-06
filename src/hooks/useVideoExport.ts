import { useState, useCallback, useRef } from 'react';
import { getAlbumArtUrl } from '@/hooks/useData';
import type { TimelineEntry, Song, Discography, ExportSettings } from '@/types';
import clipManifest from '@/data/clips-manifest.json';
import type { ReactionClip } from '@/types';

const clips = clipManifest as ReactionClip[];

// Export server base URL. Set VITE_EXPORT_API to the Cloud Run service URL for
// production builds; falls back to the local Bun server for development.
const EXPORT_BASE =
  import.meta.env.VITE_EXPORT_API ?? 'http://localhost:3001';
const EXPORT_API = `${EXPORT_BASE.replace(/\/$/, '')}/export`;

// Phases reported by the server's SSE progress stream.
export type ExportPhase = 'preparing' | 'assets' | 'encoding' | 'finalizing';

export interface ExportStatus {
  phase: ExportPhase;
  entryCount: number;
  resolution: ExportSettings['resolution'];
  // assets phase: which entry's media is being fetched (1-based).
  assetIndex: number;
  assetTotal: number;
  // encoding phase: ffmpeg percent, or null when duration is unknown.
  encodePct: number | null;
}

// Events the server streams (mirror of the server's ExportEvent union).
type ServerEvent =
  | { type: 'start'; entries: number; resolution: ExportSettings['resolution'] }
  | { type: 'asset'; index: number; total: number; song: string; artOk: boolean; audioOk: boolean }
  | { type: 'ffmpeg_start'; totalMs: number }
  | { type: 'ffmpeg_progress'; pct: number | null; outMs: number }
  | { type: 'done'; bytes: number; dataB64: string }
  | { type: 'error'; message: string };

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
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
        phase: 'preparing',
        entryCount: validEntries.length,
        resolution: settings.resolution,
        assetIndex: 0,
        assetTotal: validEntries.length,
        encodePct: null,
      });

      // Live elapsed-time ticker so the panel never looks frozen.
      const startedAt = Date.now();
      setElapsedMs(0);
      timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 500);

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
            durationMs: clip.durationMs,
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

        if (!resp.ok || !resp.body) {
          const body = await resp.json().catch(() => ({}));
          throw new Error(body.error || `Server error ${resp.status}`);
        }

        // Parse the SSE stream: frames are separated by a blank line, each
        // carrying one `data: <json>` line.
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let resultB64: string | null = null;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          let sep: number;
          while ((sep = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, sep);
            buf = buf.slice(sep + 2);

            const dataLine = frame
              .split('\n')
              .find((l) => l.startsWith('data:'));
            if (!dataLine) continue;

            const event = JSON.parse(dataLine.slice(5).trim()) as ServerEvent;

            if (event.type === 'error') throw new Error(event.message);
            if (event.type === 'done') {
              resultB64 = event.dataB64;
              setStatus((s) => (s ? { ...s, phase: 'finalizing' } : s));
              continue;
            }

            setStatus((s) => {
              if (!s) return s;
              switch (event.type) {
                case 'asset':
                  return {
                    ...s,
                    phase: 'assets',
                    assetIndex: event.index + 1,
                    assetTotal: event.total,
                  };
                case 'ffmpeg_start':
                  return { ...s, phase: 'encoding', encodePct: 0 };
                case 'ffmpeg_progress':
                  return { ...s, phase: 'encoding', encodePct: event.pct };
                default:
                  return s;
              }
            });
          }
        }

        if (!resultB64) throw new Error('Export ended without a result');

        const blob = base64ToBlob(resultB64, 'video/mp4');
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
