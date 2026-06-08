import { useSongSearch } from '@/hooks/useSongSearch';
import { SongFilters } from './SongFilters';
import { getAlbumArtUrl } from '@/hooks/useData';
import type { Song, Artist, Discography, Series } from '@/types';

interface SongPickerProps {
  songs: Song[];
  series: Series[];
  artistMap: Map<string, Artist>;
  discographyMap: Map<string, Discography>;
  onSelect: (songId: string) => void;
  onClose: () => void;
}

export function SongPicker({
  songs,
  series,
  artistMap,
  discographyMap,
  onSelect,
  onClose,
}: SongPickerProps) {
  const { query, setQuery, filter, setFilter, results } =
    useSongSearch(songs);

  return (
    <div className="flex h-full flex-col bg-[#1a1a2e]">
      <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
        <h3 className="font-semibold text-white">Select Song</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-xl leading-none"
        >
          &times;
        </button>
      </div>

      <div className="border-b border-gray-700 p-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search songs (English or Japanese)..."
          className="w-full rounded-lg bg-gray-800 px-4 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-pink-500"
          autoFocus
        />
      </div>

      <SongFilters
        series={series}
        artistMap={artistMap}
        filter={filter}
        onFilterChange={setFilter}
      />

      <div className="flex-1 overflow-y-auto">
        {results.length === 0 ? (
          <p className="p-4 text-center text-sm text-gray-500">
            No songs found
          </p>
        ) : (
          <ul>
            {results.map((song) => {
              const artist = song.artists[0]
                ? artistMap.get(song.artists[0].id)
                : null;
              const artUrl = getAlbumArtUrl(song, discographyMap);
              const seriesColor =
                series.find((s) => song.seriesIds.includes(s.id))?.color ??
                '#666';

              return (
                <li key={song.id}>
                  <button
                    onClick={() => onSelect(song.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-800"
                  >
                    <div
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: seriesColor }}
                    />
                    {artUrl && (
                      <img
                        src={artUrl}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded object-cover"
                        loading="lazy"
                        crossOrigin="anonymous"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {song.name}
                      </p>
                      <p className="truncate text-xs text-gray-400">
                        {song.englishName}
                        {artist ? ` · ${artist.name}` : ''}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
