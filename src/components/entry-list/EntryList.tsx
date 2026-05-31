import { useState } from 'react';
import { getAlbumArtUrl } from '@/hooks/useData';
import type { TimelineEntry, Song, Discography, ReactionClip } from '@/types';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function parseTime(value: string): number | null {
  const parts = value.split(':');
  if (parts.length === 2) {
    const m = parseInt(parts[0]!, 10);
    const s = parseInt(parts[1]!, 10);
    if (!isNaN(m) && !isNaN(s)) return m * 60 + s;
  }
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}

function TimeInput({ value, onChange }: { value: number | null; onChange: (t: number | null) => void }) {
  const [text, setText] = useState(value != null ? formatTime(value) : '');

  const commit = () => {
    const t = text.trim() ? parseTime(text) : null;
    onChange(t);
    if (t != null) setText(formatTime(t));
  };

  return (
    <input
      type="text"
      placeholder="0:00"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className="w-14 shrink-0 rounded bg-gray-900 px-2 py-1 text-center text-xs text-gray-300 outline-none focus:ring-1 focus:ring-pink-500"
      title="Song start time (m:ss)"
    />
  );
}

interface EntryListProps {
  entries: TimelineEntry[];
  songMap: Map<string, Song>;
  discographyMap: Map<string, Discography>;
  clips: ReactionClip[];
  onPickSong: (entryId: string) => void;
  onPickClip: (entryId: string) => void;
  onRemove: (entryId: string) => void;
  onUpdateStartTime: (entryId: string, time: number | null) => void;
}

export function EntryList({
  entries,
  songMap,
  discographyMap,
  clips,
  onPickSong,
  onPickClip,
  onRemove,
  onUpdateStartTime,
}: EntryListProps) {
  return (
    <div className="w-full max-w-2xl space-y-2">
      {entries.map((entry, index) => {
        const song = entry.songId ? songMap.get(entry.songId) : null;
        const clip = entry.clipId
          ? clips.find((c) => c.id === entry.clipId)
          : null;
        const artUrl = song ? getAlbumArtUrl(song, discographyMap) : null;

        return (
          <div
            key={entry.id}
            className="group flex items-center gap-4 rounded-lg bg-gray-800/60 px-4 py-3"
          >
            <span className="w-6 shrink-0 text-center text-sm text-gray-500">
              {index + 1}
            </span>

            <button
              onClick={() => onPickSong(entry.id)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 text-left hover:bg-gray-700/50"
            >
              {artUrl ? (
                <img
                  src={artUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-gray-700 text-xs text-gray-500">
                  ♪
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {song ? song.name : 'No song selected'}
                </p>
                {song?.englishName && song.englishName !== song.name && (
                  <p className="truncate text-xs text-gray-400">
                    {song.englishName}
                  </p>
                )}
              </div>
            </button>

            {song && (
              <TimeInput
                value={entry.songStartTime}
                onChange={(t) => onUpdateStartTime(entry.id, t)}
              />
            )}

            <button
              onClick={() => onPickClip(entry.id)}
              className="shrink-0 rounded-md border border-gray-600 px-3 py-1.5 text-xs text-gray-300 hover:border-gray-400 hover:text-white"
            >
              {clip ? clip.name : '+ Clip'}
            </button>

            <button
              onClick={() => onRemove(entry.id)}
              className="shrink-0 text-gray-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
            >
              &times;
            </button>
          </div>
        );
      })}
    </div>
  );
}
