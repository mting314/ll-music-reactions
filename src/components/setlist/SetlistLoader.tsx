import { useState } from 'react';
import { useSetlist } from '@/hooks/useSetlist';
import type { TimelineEntry } from '@/types';

interface SetlistLoaderProps {
  onLoad: (entries: TimelineEntry[]) => void;
  onClose: () => void;
}

export function SetlistLoader({ onLoad, onClose }: SetlistLoaderProps) {
  const { searchPerformances, loadSetlist } = useSetlist();
  const [query, setQuery] = useState('');
  const results = searchPerformances(query);

  const handleSelect = (performanceId: string) => {
    const entries = loadSetlist(performanceId);
    onLoad(entries);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-[#1a1a2e] shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-700 px-6 py-4">
          <h3 className="text-lg font-semibold text-white">Load Setlist</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            &times;
          </button>
        </div>

        <div className="border-b border-gray-700 p-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by tour name, venue, or date..."
            className="w-full rounded-lg bg-gray-800 px-4 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-pink-500"
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {results.length === 0 ? (
            <p className="p-4 text-center text-sm text-gray-500">
              No performances found
            </p>
          ) : (
            <ul>
              {results.map((perf) => (
                <li key={perf.id}>
                  <button
                    onClick={() => handleSelect(perf.id)}
                    className="flex w-full flex-col px-6 py-3 text-left hover:bg-gray-800"
                  >
                    <p className="text-sm font-medium text-white">
                      {perf.tourName}
                    </p>
                    <p className="text-xs text-gray-400">
                      {perf.date} · {perf.venue}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
