import { useState } from 'react';
import type { Artist, Series, SongFilter } from '@/types';

interface SongFiltersProps {
  series: Series[];
  artistMap: Map<string, Artist>;
  filter: SongFilter;
  onFilterChange: (filter: SongFilter) => void;
}

export function SongFilters({
  series,
  artistMap,
  filter,
  onFilterChange,
}: SongFiltersProps) {
  const [expanded, setExpanded] = useState(false);

  const artists = Array.from(artistMap.values());
  const hasActiveFilters =
    filter.series.length > 0 || filter.artists.length > 0 || filter.years.length > 0;

  const toggleSeries = (id: number) => {
    const next = filter.series.includes(id)
      ? filter.series.filter((s) => s !== id)
      : [...filter.series, id];
    onFilterChange({ ...filter, series: next });
  };

  const toggleArtist = (id: string) => {
    const next = filter.artists.includes(id)
      ? filter.artists.filter((a) => a !== id)
      : [...filter.artists, id];
    onFilterChange({ ...filter, artists: next });
  };

  const clearFilters = () => {
    onFilterChange({ series: [], artists: [], years: [] });
  };

  return (
    <div className="border-b border-gray-700">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm text-gray-400 hover:text-white"
      >
        <span>
          Filters{hasActiveFilters ? ' (active)' : ''}
        </span>
        <span>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="space-y-3 px-4 pb-4">
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="text-xs text-pink-400 hover:text-pink-300"
            >
              Clear all filters
            </button>
          )}

          <div>
            <p className="mb-1 text-xs font-medium text-gray-500 uppercase">
              Series
            </p>
            <div className="flex flex-wrap gap-2">
              {series.map((s) => (
                <button
                  key={s.id}
                  onClick={() => toggleSeries(s.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filter.series.includes(s.id)
                      ? 'text-white'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                  style={
                    filter.series.includes(s.id)
                      ? { backgroundColor: s.color }
                      : undefined
                  }
                >
                  {s.englishName.length > 25
                    ? s.englishName.slice(0, 22) + '...'
                    : s.englishName}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-gray-500 uppercase">
              Artist
            </p>
            <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
              {artists
                .filter((a) => a.seriesIds.length > 0)
                .slice(0, 30)
                .map((a) => (
                  <button
                    key={a.id}
                    onClick={() => toggleArtist(a.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      filter.artists.includes(a.id)
                        ? 'bg-pink-600 text-white'
                        : 'bg-gray-800 text-gray-400 hover:text-white'
                    }`}
                  >
                    {a.name}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
