import { useState, useRef, useEffect } from 'react';
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
import { detectLeadIn } from '@/utils/audio';
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

  // Reflect external changes (e.g. set via the scrubber) into the text box.
  // `value` only changes after a commit, never mid-typing, so this won't
  // clobber in-progress input.
  useEffect(() => {
    setText(value != null ? formatTime(value) : '');
  }, [value]);

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

// Only one row's audio should play at a time. Tracked at module scope so a
// row starting playback can pause whichever row was playing before.
let currentlyPlaying: HTMLAudioElement | null = null;

interface AudioAnalysis {
  leadIn: number;
  duration: number;
  failed: boolean;
}

// A single shared AudioContext for ALL decodes. Browsers hard-cap the number of
// AudioContexts (~6 in Chrome) and throw once exceeded — creating one per row
// (doubled by StrictMode in dev) blows that limit and makes every decode fail.
// One shared, never-closed context sidesteps it.
let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (sharedAudioCtx) return sharedAudioCtx;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  sharedAudioCtx = new Ctx();
  return sharedAudioCtx;
}

const PENDING_ANALYSIS: AudioAnalysis = { leadIn: 0, duration: 0, failed: false };

// Decoded results are cached by URL (module scope) so a song is only ever
// fetched + decoded once — across rows, reorders, remounts, and duplicate songs.
const analysisCache = new Map<string, AudioAnalysis>();
const analysisInflight = new Map<string, Promise<AudioAnalysis>>();

/**
 * Fetch + decode a song's audio (Web Audio API) once, returning its leading
 * silence AND exact duration. We use the decoded buffer rather than the <audio>
 * element's metadata because the catalog audio is Ogg, whose element-reported
 * `duration` is often `Infinity` in Chrome until fully buffered. Result (incl.
 * `failed`) is cached and in-flight requests are de-duped.
 */
function analyzeAudio(src: string): Promise<AudioAnalysis> {
  const cached = analysisCache.get(src);
  if (cached) return Promise.resolve(cached);
  const existing = analysisInflight.get(src);
  if (existing) return existing;

  const p = (async (): Promise<AudioAnalysis> => {
    try {
      // no-referrer is required: fandom hotlink-protection 404s any request
      // carrying an external Referer (same as the album-art <img>s).
      const res = await fetch(src, { mode: 'cors', referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      const ctx = getAudioCtx();
      if (!ctx) throw new Error('no AudioContext');
      const buf = await ctx.decodeAudioData(bytes);
      return {
        leadIn: detectLeadIn(buf.getChannelData(0), buf.sampleRate),
        duration: buf.duration,
        failed: false,
      };
    } catch {
      return { leadIn: 0, duration: 0, failed: true };
    }
  })()
    .then((a) => {
      analysisCache.set(src, a);
      return a;
    })
    .finally(() => analysisInflight.delete(src));

  analysisInflight.set(src, p);
  return p;
}

/**
 * Lazily analyze a song's audio: the fetch + decode (a full ~MBs download per
 * song) only runs once `active` is true — wired to viewport visibility so a long
 * timeline doesn't decode every off-screen row up front. Cached results return
 * synchronously.
 */
function useAudioAnalysis(src: string | null | undefined, active: boolean): AudioAnalysis {
  const [, forceUpdate] = useState(0);
  const cached = src ? analysisCache.get(src) : undefined;

  useEffect(() => {
    if (!src || !active || analysisCache.has(src)) return;
    let cancelled = false;
    analyzeAudio(src).then(() => {
      if (!cancelled) forceUpdate((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [src, active]);

  return cached ?? PENDING_ANALYSIS;
}

/**
 * Report when an element has first scrolled into (or near) the viewport, so work
 * can be deferred until then. Latches true once and stops observing.
 */
function useInView<T extends Element>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true); // no IO support: don't gate the feature
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin: '300px' }, // warm up rows just below the fold
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  return [ref, inView] as const;
}

/**
 * A mini audio player + scrubber. The slider's resting position IS the song's
 * start timestamp: drag it (or play and pause at the right spot) to set where
 * the song begins in the exported video.
 *
 * All positions here are **relative to the music onset** (`leadIn`): the slider
 * shows time-since-sound-start, while `startTime`/`onCommit` are absolute file
 * offsets (what the exporter consumes). leadIn bridges the two so the leading
 * silence is skipped from the user's point of view.
 */
function AudioScrubber({
  src,
  startTime,
  leadIn,
  duration: decodedDuration,
  failed,
  onCommit,
}: {
  src: string;
  startTime: number | null;
  leadIn: number;
  duration: number;
  failed: boolean;
  onCommit: (t: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const toRel = (abs: number) => Math.max(0, abs - leadIn);
  const [position, setPosition] = useState(toRel(startTime ?? leadIn));
  const [isPlaying, setIsPlaying] = useState(false);
  const draggingRef = useRef(false);

  // Audible length, relative to the music onset. Sourced from the decoded
  // buffer — the <audio> element reports Infinity for Ogg until fully buffered.
  const duration = Math.max(0, decodedDuration - leadIn);

  // Follow external start-time / lead-in changes (typed in the text box, or the
  // lead-in finishing decode) while the user isn't scrubbing or listening.
  useEffect(() => {
    if (!draggingRef.current && !isPlaying) setPosition(toRel(startTime ?? leadIn));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime, leadIn, isPlaying]);

  // Commit an absolute file offset, rounded to 0.1s (stable against float noise).
  const commit = (rel: number) => onCommit(Math.round((leadIn + rel) * 10) / 10);

  const seek = (rel: number) => {
    if (audioRef.current) audioRef.current.currentTime = leadIn + rel;
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      audio.currentTime = leadIn + position;
      audio.play().catch(() => {});
    }
  };

  // The audio file is missing/undecodable (e.g. a stale 404 wikiAudioUrl, or an
  // unsupported codec) — show why instead of a dead slider. The text box still
  // lets you set a start time by hand.
  if (failed) {
    return (
      <p className="text-[11px] italic text-gray-600">
        Audio preview unavailable — set the start time manually.
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <audio
        ref={audioRef}
        src={src}
        // The decode fetch already pulls the full file for lead-in/duration;
        // let the element load lazily on play to avoid a second eager fetch.
        preload="none"
        crossOrigin="anonymous"
        onPlay={() => {
          if (currentlyPlaying && currentlyPlaying !== audioRef.current) {
            currentlyPlaying.pause();
          }
          currentlyPlaying = audioRef.current;
          setIsPlaying(true);
        }}
        onPause={() => {
          // Preview only — never commit here. Pausing must not change the start
          // time, especially since starting another row programmatically pauses
          // this one (which would otherwise clobber its saved start).
          setIsPlaying(false);
          if (currentlyPlaying === audioRef.current) currentlyPlaying = null;
        }}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(e) => {
          if (!draggingRef.current) setPosition(toRel(e.currentTarget.currentTime));
        }}
      />

      <button
        onClick={togglePlay}
        className="shrink-0 rounded px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 hover:text-white"
        title={isPlaying ? 'Pause' : 'Play from start time'}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? '❚❚' : '►'}
      </button>

      <input
        type="range"
        min={0}
        max={duration}
        step={0.1}
        value={Math.min(position, duration)}
        disabled={!duration}
        onChange={(e) => {
          const rel = parseFloat(e.target.value);
          draggingRef.current = true;
          setPosition(rel);
          seek(rel);
        }}
        onPointerUp={() => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          commit(position);
        }}
        onKeyUp={() => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          commit(position);
        }}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-pink-600 disabled:cursor-default disabled:opacity-40"
        title="Drag to set the song start time (relative to where the music begins)"
      />

      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-gray-500">
        {formatTime(position)}
      </span>
    </div>
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

  // Decode the song's audio for its leading silence + exact duration — but only
  // once the row scrolls into view, so a long timeline doesn't fetch+decode
  // every off-screen song up front. Start times are stored as absolute file
  // offsets (the exporter consumes them) but shown relative to the music onset,
  // so the blank space at the top of the file is skipped in the UI.
  const [scrubberRef, inView] = useInView<HTMLDivElement>();
  const { leadIn, duration, failed } = useAudioAnalysis(song?.wikiAudioUrl, inView);
  const relStart = entry.songStartTime == null ? null : Math.max(0, entry.songStartTime - leadIn);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative flex flex-col gap-2 rounded-lg bg-gray-800/60 px-2 py-3 sm:px-4"
    >
      <div className="flex items-center gap-2 sm:gap-4">
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
            value={relStart}
            onChange={(t) =>
              onUpdateStartTime(entry.id, t == null ? null : t + leadIn)
            }
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

      {song?.wikiAudioUrl && (
        <div ref={scrubberRef} className="pl-8 pr-6 sm:pl-12">
          <AudioScrubber
            src={song.wikiAudioUrl}
            startTime={entry.songStartTime}
            leadIn={leadIn}
            duration={duration}
            failed={failed}
            onCommit={(t) => onUpdateStartTime(entry.id, t)}
          />
        </div>
      )}
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
