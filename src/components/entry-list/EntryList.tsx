import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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
  onReorder: (fromIndex: number, toIndex: number) => void;
  onUpdateStartTime: (entryId: string, time: number | null) => void;
}

function SortableRow({
  entry,
  index,
  songMap,
  discographyMap,
  clips,
  onPickSong,
  onPickClip,
  onRemove,
  onUpdateStartTime,
}: {
  entry: TimelineEntry;
  index: number;
  songMap: Map<string, Song>;
  discographyMap: Map<string, Discography>;
  clips: ReactionClip[];
  onPickSong: (id: string) => void;
  onPickClip: (id: string) => void;
  onRemove: (id: string) => void;
  onUpdateStartTime: (id: string, time: number | null) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const song = entry.songId ? songMap.get(entry.songId) : null;
  const clip = entry.clipId ? clips.find((c) => c.id === entry.clipId) : null;
  const artUrl = song ? getAlbumArtUrl(song, discographyMap) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative flex items-center gap-2 rounded-lg bg-gray-800/60 px-2 py-3 sm:gap-4 sm:px-4"
    >
      {/* drag handle — only this element starts a drag, so the buttons stay
          clickable. A div (not a button) matches Timeline and avoids a native
          button's default submit type + redundant ARIA. */}
      <div
        {...attributes}
        {...listeners}
        className="shrink-0 cursor-grab touch-none px-1 text-gray-600 hover:text-gray-300 active:cursor-grabbing"
        title="Drag to reorder"
      >
        ⠿
      </div>

      <span className="w-5 shrink-0 text-center text-sm text-gray-500">
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
            crossOrigin="anonymous"
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
            <p className="truncate text-xs text-gray-400">{song.englishName}</p>
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
}

export function EntryList({
  entries,
  songMap,
  discographyMap,
  clips,
  onPickSong,
  onPickClip,
  onRemove,
  onReorder,
  onUpdateStartTime,
}: EntryListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = entries.findIndex((e) => e.id === active.id);
    const toIndex = entries.findIndex((e) => e.id === over.id);
    if (fromIndex !== -1 && toIndex !== -1) {
      onReorder(fromIndex, toIndex);
    }
  };

  return (
    <div className="w-full max-w-2xl">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={entries.map((e) => e.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {entries.map((entry, index) => (
              <SortableRow
                key={entry.id}
                entry={entry}
                index={index}
                songMap={songMap}
                discographyMap={discographyMap}
                clips={clips}
                onPickSong={onPickSong}
                onPickClip={onPickClip}
                onRemove={onRemove}
                onUpdateStartTime={onUpdateStartTime}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
