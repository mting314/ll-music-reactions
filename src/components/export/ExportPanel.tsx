import { useState } from 'react';
import type { ExportSettings } from '@/types';
import type { ExportStatus } from '@/hooks/useVideoExport';

interface ExportPanelProps {
  validCount: number;
  isExporting: boolean;
  error: string | null;
  status: ExportStatus | null;
  elapsedMs: number;
  onStartExport: (settings: ExportSettings) => void;
  onDismiss: () => void;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatMB(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

const PHASE_LABEL: Record<ExportStatus['phase'], string> = {
  preparing: 'Preparing export',
  encoding: 'Stitching clips on the cloud',
  downloading: 'Downloading your video',
};

export function ExportPanel({
  validCount,
  isExporting,
  error,
  status,
  elapsedMs,
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

        {isExporting && status && (
          <div className="py-1">
            {(() => {
              const determinate =
                status.phase === 'downloading' && status.totalBytes;
              const pct = determinate
                ? Math.min(
                    100,
                    Math.round((status.receivedBytes / status.totalBytes!) * 100),
                  )
                : null;

              return (
                <>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-xs font-medium text-white">
                      {PHASE_LABEL[status.phase]}…
                    </span>
                    <span className="font-mono text-[11px] text-gray-500">
                      {formatElapsed(elapsedMs)}
                    </span>
                  </div>

                  <div className="mb-2 h-2 overflow-hidden rounded-full bg-gray-800">
                    {pct !== null ? (
                      <div
                        className="h-full rounded-full bg-pink-600 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    ) : (
                      <div className="h-full w-full animate-pulse rounded-full bg-pink-600" />
                    )}
                  </div>

                  <p className="text-xs text-gray-400">
                    {status.phase === 'downloading' ? (
                      <>
                        {formatMB(status.receivedBytes)}
                        {status.totalBytes
                          ? ` of ${formatMB(status.totalBytes)}`
                          : ''}
                      </>
                    ) : (
                      <>
                        {status.entryCount}{' '}
                        {status.entryCount === 1 ? 'clip' : 'clips'} at{' '}
                        {status.resolution}
                      </>
                    )}
                  </p>

                  {status.phase === 'encoding' && (
                    <p className="mt-1 text-[11px] text-gray-600">
                      The first export can take a few extra seconds to warm up.
                    </p>
                  )}
                </>
              );
            })()}
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
