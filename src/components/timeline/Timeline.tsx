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
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getAlbumArtUrl } from '@/hooks/useData';
import { useClips } from '@/hooks/useData';
import type { TimelineEntry, Song, Discography } from '@/types';

interface TimelineProps {
  entries: TimelineEntry[];
  songMap: Map<string, Song>;
  discographyMap: Map<string, Discography>;
  onAdd: () => void;
  onRemove: (entryId: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onPickSong: (entryId: string) => void;
  onPickClip: (entryId: string) => void;
}

function SortableEntry({
  entry,
  songMap,
  discographyMap,
  clips,
  onRemove,
  onPickSong,
  onPickClip,
}: {
  entry: TimelineEntry;
  songMap: Map<string, Song>;
  discographyMap: Map<string, Discography>;
  clips: import('@/types').ReactionClip[];
  onRemove: (id: string) => void;
  onPickSong: (id: string) => void;
  onPickClip: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: entry.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const song = entry.songId ? songMap.get(entry.songId) : null;
  const clip = entry.clipId
    ? clips.find((c) => c.id === entry.clipId)
    : null;
  const artUrl = song ? getAlbumArtUrl(song, discographyMap) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative flex w-44 shrink-0 flex-col rounded-lg bg-gray-800 p-2"
    >
      <div
        {...attributes}
        {...listeners}
        className="mb-2 cursor-grab text-center text-xs text-gray-600 active:cursor-grabbing"
      >
        ⠿
      </div>

      <button
        onClick={() => onPickClip(entry.id)}
        className="mb-2 flex aspect-video items-center justify-center rounded bg-gray-900 text-xs text-gray-500 hover:bg-gray-700"
      >
        {clip ? (
          <span className="text-white">{clip.name}</span>
        ) : (
          '+ Clip'
        )}
      </button>

      <button
        onClick={() => onPickSong(entry.id)}
        className="flex items-center gap-2 rounded bg-gray-900 p-2 text-left hover:bg-gray-700"
      >
        {artUrl && (
          <img
            src={artUrl}
            alt=""
            className="h-8 w-8 shrink-0 rounded object-cover"
            loading="lazy"
            crossOrigin="anonymous"
            referrerPolicy="no-referrer"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-gray-300">
          {song ? song.name : '+ Song'}
        </span>
      </button>

      <button
        onClick={() => onRemove(entry.id)}
        className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white group-hover:flex"
      >
        &times;
      </button>
    </div>
  );
}

export function Timeline({
  entries,
  songMap,
  discographyMap,
  onAdd,
  onRemove,
  onReorder,
  onPickSong,
  onPickClip,
}: TimelineProps) {
  const clips = useClips();
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
    <div className="border-t border-gray-700 bg-[#12121f] px-4 py-3">
      <div className="flex items-center gap-3 overflow-x-auto pb-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={entries.map((e) => e.id)}
            strategy={horizontalListSortingStrategy}
          >
            {entries.map((entry) => (
              <SortableEntry
                key={entry.id}
                entry={entry}
                songMap={songMap}
                discographyMap={discographyMap}
                clips={clips}
                onRemove={onRemove}
                onPickSong={onPickSong}
                onPickClip={onPickClip}
              />
            ))}
          </SortableContext>
        </DndContext>

        <button
          onClick={onAdd}
          className="flex h-32 w-20 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-gray-700 text-2xl text-gray-600 hover:border-gray-500 hover:text-gray-400"
        >
          +
        </button>
      </div>
    </div>
  );
}
