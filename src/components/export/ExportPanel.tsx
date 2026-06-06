import { useState } from 'react';
import type { ExportSettings } from '@/types';

interface ExportPanelProps {
  validCount: number;
  isExporting: boolean;
  error: string | null;
  onStartExport: (settings: ExportSettings) => void;
  onDismiss: () => void;
}

export function ExportPanel({
  validCount,
  isExporting,
  error,
  onStartExport,
  onDismiss,
}: ExportPanelProps) {
  const [settings, setSettings] = useState<ExportSettings>({
    resolution: '720p',
    overlayPosition: 'top-right',
    overlaySize: 120,
  });

  return (
    <div className="fixed bottom-20 right-4 z-40 w-80 rounded-xl bg-[#1a1a2e] shadow-2xl border border-gray-700">
      <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
        <h3 className="text-sm font-semibold text-white">Export</h3>
        {!isExporting && (
          <button
            onClick={onDismiss}
            className="text-gray-400 hover:text-white text-lg leading-none"
          >
            &times;
          </button>
        )}
      </div>

      <div className="space-y-3 p-4">
        {!isExporting && (
          <>
            <p className="text-xs text-gray-400">
              {validCount} complete {validCount === 1 ? 'entry' : 'entries'}
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
                    className={`rounded px-3 py-1.5 text-xs ${
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
              <div className="grid grid-cols-2 gap-1.5">
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
                    className={`rounded px-2 py-1.5 text-xs ${
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

            <button
              onClick={() => onStartExport(settings)}
              disabled={validCount === 0}
              className="w-full rounded-lg bg-pink-600 py-2 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Export Video
            </button>
          </>
        )}

        {isExporting && (
          <div className="py-2 text-center">
            <div className="mb-2 h-2 overflow-hidden rounded-full bg-gray-800">
              <div className="h-full w-full animate-pulse rounded-full bg-pink-600" />
            </div>
            <p className="text-xs text-gray-400">
              Encoding on the cloud...
            </p>
          </div>
        )}

        {error && (
          <p className="rounded bg-red-900/30 p-2 text-xs text-red-400">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
