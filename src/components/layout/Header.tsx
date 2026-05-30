interface HeaderProps {
  onLoadSetlist: () => void;
  onPreview: () => void;
  onExport: () => void;
  hasEntries: boolean;
}

export function Header({
  onLoadSetlist,
  onPreview,
  onExport,
  hasEntries,
}: HeaderProps) {
  return (
    <header className="flex items-center justify-between border-b border-gray-700 bg-[#1a1a2e] px-6 py-3">
      <h1 className="text-lg font-bold text-white">
        <span className="text-pink-400">LL</span> Music Reactions
      </h1>

      <div className="flex gap-3">
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
      </div>
    </header>
  );
}
