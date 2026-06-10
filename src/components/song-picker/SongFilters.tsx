import { useMemo, useState } from 'react';
import type { Artist, Series, Song, SongFilter, SongType } from '@/types';
import { getAvailableYears } from '@/utils/filters';

interface SongFiltersProps {
  songs: Song[];
  series: Series[];
  artistMap: Map<string, Artist>;
  filter: SongFilter;
  onFilterChange: (filter: SongFilter) => void;
}

const TYPE_OPTIONS: { id: SongType; label: string }[] = [
  { id: 'solo', label: 'Solo' },
  { id: 'unit', label: 'Unit' },
  { id: 'group', label: 'Group' },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export function SongFilters({
  songs,
  series,
  artistMap,
  filter,
  onFilterChange,
}: SongFiltersProps) {
  const [expanded, setExpanded] = useState(false);
  const [artistQuery, setArtistQuery] = useState('');

  const years = useMemo(() => getAvailableYears(songs), [songs]);

  // Only offer artists that actually appear on a song.
  const artists = useMemo(() => {
    const onSongs = new Set<string>();
    for (const s of songs) for (const a of s.artists) onSongs.add(a.id);
    return Array.from(artistMap.values())
      .filter((a) => onSongs.has(a.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [songs, artistMap]);

  const visibleArtists = useMemo(() => {
    const q = artistQuery.trim().toLowerCase();
    if (!q) return artists;
    return artists.filter((a) => a.name.toLowerCase().includes(q));
  }, [artists, artistQuery]);

  const activeCount =
    filter.series.length +
    filter.artists.length +
    filter.years.length +
    filter.types.length;

  const clearFilters = () =>
    onFilterChange({ series: [], artists: [], years: [], types: [] });

  return (
    <div className="border-b border-gray-700">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm text-gray-400 hover:text-white"
      >
        <span>Filters{activeCount > 0 ? ` (${activeCount})` : ''}</span>
        <span>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="max-h-72 space-y-3 overflow-y-auto px-4 pb-4">
          {activeCount > 0 && (
            <button
              onClick={clearFilters}
              className="text-xs text-pink-400 hover:text-pink-300"
            >
              Clear all filters
            </button>
          )}

          {/* Series */}
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-gray-500">Series</p>
            <div className="flex flex-wrap gap-2">
              {series.map((s) => {
                const on = filter.series.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() =>
                      onFilterChange({ ...filter, series: toggle(filter.series, s.id) })
                    }
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      on ? 'text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                    }`}
                    style={on ? { backgroundColor: s.color || '#666' } : undefined}
                  >
                    {s.englishName.length > 25
                      ? s.englishName.slice(0, 22) + '…'
                      : s.englishName}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Type */}
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-gray-500">Type</p>
            <div className="flex flex-wrap gap-2">
              {TYPE_OPTIONS.map((t) => {
                const on = filter.types.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() =>
                      onFilterChange({ ...filter, types: toggle(filter.types, t.id) })
                    }
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      on ? 'bg-pink-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Year */}
          {years.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase text-gray-500">Year</p>
              <div className="flex flex-wrap gap-2">
                {years.map((y) => {
                  const on = filter.years.includes(y);
                  return (
                    <button
                      key={y}
                      onClick={() =>
                        onFilterChange({ ...filter, years: toggle(filter.years, y) })
                      }
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        on ? 'bg-pink-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                      }`}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Artist (searchable, all artists that appear on songs) */}
          <div>
            <p className="mb-1 text-xs font-medium uppercase text-gray-500">
              Artist{filter.artists.length > 0 ? ` (${filter.artists.length})` : ''}
            </p>
            <input
              type="text"
              value={artistQuery}
              onChange={(e) => setArtistQuery(e.target.value)}
              placeholder="Filter artists…"
              className="mb-2 w-full rounded bg-gray-800 px-3 py-1.5 text-xs text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-pink-500"
            />
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {visibleArtists.length === 0 ? (
                <span className="text-xs text-gray-600">No matching artists</span>
              ) : (
                visibleArtists.map((a) => {
                  const on = filter.artists.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      onClick={() =>
                        onFilterChange({
                          ...filter,
                          artists: toggle(filter.artists, a.id),
                        })
                      }
                      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                        on ? 'bg-pink-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                      }`}
                    >
                      {a.name}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
