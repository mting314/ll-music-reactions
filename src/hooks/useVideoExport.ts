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

// Observable phases of an export. The server does the asset-download + ffmpeg
// work opaquely inside a single request, so "encoding" covers that whole
// window; we report the transitions we can actually see plus a live timer.
export type ExportPhase = 'preparing' | 'encoding' | 'downloading';

export interface ExportStatus {
  phase: ExportPhase;
  entryCount: number;
  resolution: ExportSettings['resolution'];
  // Bytes of the resulting MP4 received so far (downloading phase only).
  receivedBytes: number;
  // Total size if the server sent Content-Length, else null (unknown).
  totalBytes: number | null;
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
        receivedBytes: 0,
        totalBytes: null,
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
          };
        });

        // Server is now working (downloading assets + running ffmpeg) until the
        // response headers arrive.
        setStatus((s) => (s ? { ...s, phase: 'encoding' } : s));

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

        // Stream the MP4 back so we can show real download progress.
        const totalBytes = Number(resp.headers.get('Content-Length')) || null;
        setStatus((s) => (s ? { ...s, phase: 'downloading', totalBytes } : s));

        let blob: Blob;
        if (resp.body) {
          const reader = resp.body.getReader();
          const chunks: Uint8Array[] = [];
          let received = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            setStatus((s) => (s ? { ...s, receivedBytes: received } : s));
          }
          blob = new Blob(chunks as BlobPart[], { type: 'video/mp4' });
        } else {
          // Fallback for environments without a readable stream.
          blob = await resp.blob();
        }

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
