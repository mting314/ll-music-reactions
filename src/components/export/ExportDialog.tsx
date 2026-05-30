import { useState } from 'react';
import { useVideoExport } from '@/hooks/useVideoExport';
import type { TimelineEntry, Song, Discography, ExportSettings } from '@/types';

interface ExportDialogProps {
  entries: TimelineEntry[];
  songMap: Map<string, Song>;
  discographyMap: Map<string, Discography>;
  onClose: () => void;
}

export function ExportDialog({
  entries,
  songMap,
  discographyMap,
  onClose,
}: ExportDialogProps) {
  const [settings, setSettings] = useState<ExportSettings>({
    resolution: '720p',
    overlayPosition: 'top-right',
    overlaySize: 120,
  });

  const { isExporting, progress, error, resultUrl, startExport, downloadResult } =
    useVideoExport();

  const validCount = entries.filter((e) => e.clipId && e.songId).length;

  const handleExport = () => {
    startExport(entries, songMap, discographyMap, settings);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl bg-[#1a1a2e] shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
          <h3 className="text-lg font-semibold text-white">Export Video</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            &times;
          </button>
        </div>

        <div className="space-y-4 p-6">
          <p className="text-sm text-gray-400">
            {validCount} complete {validCount === 1 ? 'entry' : 'entries'} will
            be included
          </p>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 uppercase">
              Resolution
            </label>
            <div className="flex gap-2">
              {(['720p', '480p'] as const).map((res) => (
                <button
                  key={res}
                  onClick={() =>
                    setSettings((s) => ({ ...s, resolution: res }))
                  }
                  className={`rounded px-4 py-2 text-sm ${
                    settings.resolution === res
                      ? 'bg-pink-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  {res}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 uppercase">
              Album Art Position
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  'top-left',
                  'top-right',
                  'bottom-left',
                  'bottom-right',
                ] as const
              ).map((pos) => (
                <button
                  key={pos}
                  onClick={() =>
                    setSettings((s) => ({ ...s, overlayPosition: pos }))
                  }
                  className={`rounded px-3 py-2 text-sm ${
                    settings.overlayPosition === pos
                      ? 'bg-pink-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  {pos.replace('-', ' ')}
                </button>
              ))}
            </div>
          </div>

          {isExporting && (
            <div>
              <div className="mb-1 flex justify-between text-xs text-gray-400">
                <span>Encoding...</span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                <div
                  className="h-full rounded-full bg-pink-600 transition-all"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <p className="rounded bg-red-900/30 p-3 text-sm text-red-400">
              {error}
            </p>
          )}

          {resultUrl && (
            <div className="rounded bg-green-900/30 p-3 text-center">
              <p className="mb-2 text-sm text-green-400">Export complete!</p>
              <button
                onClick={downloadResult}
                className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
              >
                Download MP4
              </button>
            </div>
          )}

          {!isExporting && !resultUrl && (
            <button
              onClick={handleExport}
              disabled={validCount === 0}
              className="w-full rounded-lg bg-pink-600 py-3 font-medium text-white hover:bg-pink-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Export ({validCount} {validCount === 1 ? 'entry' : 'entries'})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
