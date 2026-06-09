import { useBuildInfo } from '@/hooks/useData';

interface HeaderProps {
  onLoadSetlist: () => void;
  onPreview: () => void;
  onExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasEntries: boolean;
}

export function Header({
  onLoadSetlist,
  onPreview,
  onExport,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  hasEntries,
}: HeaderProps) {
  const build = useBuildInfo();
  // Format in UTC so every viewer sees the same date as the refresh job's
  // stamp (it runs at a fixed UTC time); local time would show "yesterday" for
  // viewers behind UTC. The exact timestamp is on hover.
  const updated = build?.generatedAt
    ? new Date(build.generatedAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  return (
    <header className="flex items-center justify-between border-b border-gray-700 bg-[#1a1a2e] px-6 py-3">
      <h1 className="text-lg font-bold text-white">
        <span className="text-pink-400">LL</span> Music Reactions
      </h1>

      <div className="flex items-center gap-3">
        <div className="flex gap-1 border-r border-gray-700 pr-3">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="rounded px-2 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Undo"
          >
            ↩
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="rounded px-2 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Redo"
          >
            ↪
          </button>
        </div>
        <button
          onClick={onLoadSetlist}
          className="rounded px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
        >
          Load Setlist
        </button>
        <button
          onClick={onPreview}
          disabled={!hasEntries}
          className="rounded px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Preview
        </button>
        <button
          onClick={onExport}
          disabled={!hasEntries}
          className="rounded bg-pink-600 px-4 py-2 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Export
        </button>

        {updated && (
          <span
            className="ml-2 whitespace-nowrap text-xs text-gray-500"
            title={`Data last refreshed ${build?.generatedAt}`}
          >
            Updated {updated}
          </span>
        )}
      </div>
    </header>
  );
}
