import {
  useState,
  useRef,
  useEffect,
  type PointerEvent as RPointerEvent,
  type KeyboardEvent as RKeyboardEvent,
} from 'react';
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
import { clamp, positionToTime, timeToPercent } from '@/utils/scrubber';
import { formatTime, parseTime } from '@/utils/time';
import type { TimelineEntry, Song, Discography, ReactionClip } from '@/types';

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
      placeholder="0:00.000"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className="w-20 shrink-0 rounded bg-gray-900 px-2 py-1 text-center text-xs tabular-nums text-gray-300 outline-none focus:ring-1 focus:ring-pink-500"
      title="Song start time (m:ss.mmm)"
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
  // Object URL for the downloaded audio, reused for playback so the file is
  // fetched once (decode + <audio> share it) instead of downloaded twice.
  blobUrl: string | null;
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

const PENDING_ANALYSIS: AudioAnalysis = {
  leadIn: 0,
  duration: 0,
  failed: false,
  blobUrl: null,
};

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
      // Keep the bytes as a Blob for playback; arrayBuffer() gives a copy for
      // decode (decodeAudioData detaches its input, leaving the Blob intact).
      const blob = await res.blob();
      const ctx = getAudioCtx();
      if (!ctx) throw new Error('no AudioContext');
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      return {
        leadIn: detectLeadIn(buf.getChannelData(0), buf.sampleRate),
        duration: buf.duration,
        failed: false,
        blobUrl: URL.createObjectURL(blob),
      };
    } catch {
      return { leadIn: 0, duration: 0, failed: true, blobUrl: null };
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
 * A two-handle audio scrubber, like a video editor's timeline:
 *
 *  - a **start marker** (the in-point) = the song's start timestamp. Drag it to
 *    set where the song begins in the export; it is the ONLY control that
 *    commits a value.
 *  - a **playhead** that follows playback and can be scrubbed for preview, but
 *    is constrained to never sit before the marker and never commits anything.
 *
 * All positions are **relative to the music onset** (`leadIn`): the track shows
 * time-since-sound-start, while `startTime`/`onCommit` are absolute file offsets
 * (what the exporter consumes). leadIn bridges the two so the leading silence is
 * skipped from the user's point of view.
 */
function AudioScrubber({
  src,
  startTime,
  leadIn,
  duration: decodedDuration,
  clipLength,
  failed,
  onCommit,
  onScrub,
}: {
  // Object URL for playback (null until the audio has been fetched/decoded).
  src: string | null;
  startTime: number | null;
  leadIn: number;
  duration: number;
  // Length of the attached reaction clip in seconds, or null when no clip is
  // set. Drives the end marker — the song plays under the clip for this long.
  clipLength: number | null;
  failed: boolean;
  onCommit: (t: number) => void;
  // Live (uncommitted) marker position in onset-relative seconds while dragging,
  // null when the drag ends. Lets the displayed start time track the scrub in
  // realtime without committing (and flooding undo history) on every move.
  onScrub?: (rel: number | null) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const toRel = (abs: number) => Math.max(0, abs - leadIn);

  // Audible length, relative to the music onset. Sourced from the decoded
  // buffer — the <audio> element reports Infinity for Ogg until fully buffered.
  const duration = Math.max(0, decodedDuration - leadIn);

  const startRel = toRel(startTime ?? leadIn);
  // Local marker position while it's being dragged; null = reflect the committed
  // start. Lets the marker move live before the commit on release.
  const [markerDrag, setMarkerDrag] = useState<number | null>(null);
  const markerRel = clamp(markerDrag ?? startRel, 0, duration || (markerDrag ?? startRel));

  // End marker: a fixed clip-length ahead of the start (the slice of the song
  // that actually plays under the clip). Tracks the start marker; not separately
  // draggable. null when no clip is attached.
  const endRel =
    clipLength != null && duration ? clamp(markerRel + clipLength, markerRel, duration) : null;

  const [playRel, setPlayRel] = useState(startRel);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const dragging = useRef<null | 'marker' | 'playhead'>(null);

  // During playback the playhead only advances on `timeupdate` (~4Hz), which
  // looks steppy — glide it with a CSS transition that bridges the gap between
  // updates. Disable the transition while scrubbing so the handle tracks the
  // pointer instantly (technique borrowed from the-sorter's heardle player).
  const playheadGlide = isPlaying && !isScrubbing ? 'left 0.25s linear' : 'none';

  // Keep the playhead within [marker, end] as the start/length change (marker
  // moved past the playhead, or decode resolving the duration). Skip while
  // dragging so we don't fight the pointer.
  useEffect(() => {
    if (dragging.current) return;
    setPlayRel((p) => clamp(p, startRel, duration || startRel));
  }, [startRel, duration]);

  // Commit an absolute file offset, rounded to the millisecond (stable against
  // float noise while preserving the precision needed for an exact start).
  const commit = (rel: number) =>
    onCommit(Math.round((leadIn + clamp(rel, 0, duration || rel)) * 1000) / 1000);

  const seek = (rel: number) => {
    if (audioRef.current) audioRef.current.currentTime = leadIn + rel;
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      return;
    }
    // Play from the playhead; if it's parked at (or ~at) the end, restart from
    // the marker. The epsilon covers timeupdate landing just shy of duration.
    const from = playRel < duration - 0.1 ? playRel : markerRel;
    setPlayRel(from);
    audio.currentTime = leadIn + from;
    audio.play().catch(() => {});
  };

  // ── pointer dragging ──────────────────────────────────────────────────────
  const timeAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    return r ? positionToTime(clientX, r.left, r.width, duration) : 0;
  };

  // Pointerdown on the track background (or the playhead thumb) scrubs the
  // playhead — clamped so it can never land before the marker.
  const onTrackPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = 'playhead';
    setIsScrubbing(true);
    // Move the handle but don't seek yet — a click or drag seeks once on release.
    setPlayRel(clamp(timeAt(e.clientX), markerRel, duration));
  };

  // Pointerdown on the marker handle drags the start point (stops propagation so
  // it doesn't also scrub the playhead).
  const onMarkerPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = 'marker';
    setIsScrubbing(true);
    // Start from the marker's current position — don't jump (or commit) to the
    // click X, so a bare click doesn't nudge a carefully-set start time. The
    // value only changes once the pointer actually moves.
    setMarkerDrag(markerRel);
  };

  // Keep audio at/after the marker so playback never sounds before the in-point.
  const keepAudioAtLeast = (rel: number) => {
    const audio = audioRef.current;
    if (audio && audio.currentTime < leadIn + rel) audio.currentTime = leadIn + rel;
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const t = timeAt(e.clientX);
    if (dragging.current === 'marker') {
      const m = clamp(t, 0, duration);
      setMarkerDrag(m);
      onScrub?.(m); // update the displayed start time live
      setPlayRel((p) => Math.max(p, m)); // playhead can't precede the marker
    } else {
      setPlayRel(clamp(t, markerRel, duration));
    }
    // NB: no seek() here — seeking on every move restarts playback constantly
    // while scrubbing. We move the handle live and seek once, on release.
  };

  const onPointerEnd = (e: RPointerEvent<HTMLDivElement>) => {
    const which = dragging.current;
    if (!which) return;
    dragging.current = null;
    setIsScrubbing(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (which === 'marker') {
      if (markerDrag != null) {
        if (markerDrag !== startRel) commit(markerDrag); // skip no-op (bare click)
        keepAudioAtLeast(markerDrag); // pull in-flight playback up to the in-point
        setMarkerDrag(null);
        onScrub?.(null); // clear the live override; display falls back to committed
      }
    } else {
      // Seek to the chosen playhead only now, on release — so scrubbing doesn't
      // restart playback on every move.
      seek(playRel);
    }
  };

  // ── keyboard ──────────────────────────────────────────────────────────────
  // Arrow keys nudge by 0.1s for fine placement; Shift+Arrow by 1s for coarse.
  const isArrow = (k: string) => k === 'ArrowLeft' || k === 'ArrowRight';
  const arrowDelta = (e: RKeyboardEvent) => {
    if (!isArrow(e.key)) return 0;
    const step = e.shiftKey ? 1 : 0.1;
    return e.key === 'ArrowLeft' ? -step : step;
  };

  const onMarkerKeyDown = (e: RKeyboardEvent) => {
    const d = arrowDelta(e);
    if (!d || !duration) return;
    e.preventDefault();
    const m = clamp((markerDrag ?? startRel) + d, 0, duration);
    setMarkerDrag(m);
    onScrub?.(m);
    setPlayRel((p) => Math.max(p, m));
    keepAudioAtLeast(m);
  };
  const onMarkerKeyUp = (e: RKeyboardEvent) => {
    if (!isArrow(e.key) || markerDrag == null) return;
    commit(markerDrag);
    setMarkerDrag(null);
    onScrub?.(null);
  };
  const onPlayheadKeyDown = (e: RKeyboardEvent) => {
    const d = arrowDelta(e);
    if (!d || !duration) return;
    e.preventDefault();
    const ph = clamp(playRel + d, markerRel, duration);
    setPlayRel(ph);
    seek(ph);
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
        // Same-origin blob URL from the single decode fetch — no second download,
        // and no CORS/referrer concerns on the element. Empty until decoded.
        src={src ?? undefined}
        preload="auto"
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
          if (dragging.current) return;
          setPlayRel(clamp(toRel(e.currentTarget.currentTime), markerRel, duration || markerRel));
        }}
      />

      <button
        onClick={togglePlay}
        disabled={!duration}
        className="shrink-0 rounded px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 hover:text-white disabled:opacity-40"
        title={isPlaying ? 'Pause' : 'Play from the playhead'}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? '❚❚' : '►'}
      </button>

      {/* Two-handle track: a draggable start marker + a playhead. */}
      <div
        ref={trackRef}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        className={`relative h-6 min-w-0 flex-1 touch-none ${
          duration ? 'cursor-pointer' : 'opacity-40'
        }`}
      >
        {/* base rail */}
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-gray-700" />
        {/* used region — [start, end] when a clip sets the end, else to the end */}
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 bg-pink-600/50"
          style={{
            left: `${timeToPercent(markerRel, duration)}%`,
            width: `${timeToPercent((endRel ?? duration) - markerRel, duration)}%`,
          }}
        />
        {/* playhead (preview position) — visual; the track handles its drag */}
        <div
          role="slider"
          tabIndex={duration ? 0 : -1}
          aria-label="Playback position"
          aria-valuemin={markerRel}
          aria-valuemax={duration}
          aria-valuenow={playRel}
          onKeyDown={onPlayheadKeyDown}
          className="pointer-events-none absolute top-1/2 z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ring-1 ring-black/40 focus:outline-none focus:ring-2 focus:ring-pink-400"
          style={{ left: `${timeToPercent(playRel, duration)}%`, transition: playheadGlide }}
        />
        {/* end marker (out-point) — derived from clip length; not draggable */}
        {endRel != null && (
          <div
            className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-pink-400/70"
            style={{ left: `${timeToPercent(endRel, duration)}%` }}
            title="Clip end"
          />
        )}
        {/* start marker (in-point) — draggable, full-height so it stays visible
            even when the playhead sits on top of it */}
        <div
          role="slider"
          tabIndex={duration ? 0 : -1}
          aria-label="Song start time"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={markerRel}
          onPointerDown={onMarkerPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onMarkerKeyDown}
          onKeyUp={onMarkerKeyUp}
          title="Drag to set the song start time"
          className="absolute inset-y-0 z-30 flex w-3 -translate-x-1/2 cursor-ew-resize touch-none justify-center focus:outline-none"
          style={{ left: `${timeToPercent(markerRel, duration)}%` }}
        >
          <div className="h-full w-0.5 bg-pink-500" />
          <div className="absolute -top-px h-1.5 w-1.5 rotate-45 bg-pink-500" />
        </div>
      </div>

      <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-gray-500">
        {formatTime(playRel)}
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
  const { leadIn, duration, failed, blobUrl } = useAudioAnalysis(song?.wikiAudioUrl, inView);
  const relStart = entry.songStartTime == null ? null : Math.max(0, entry.songStartTime - leadIn);
  // Live marker position while it's being dragged, so the displayed start time
  // tracks the scrub in realtime; the actual commit still happens on release.
  const [liveStartRel, setLiveStartRel] = useState<number | null>(null);
  const shownStartRel = liveStartRel ?? relStart;

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
            value={shownStartRel}
            onChange={(t) =>
              onUpdateStartTime(
                entry.id,
                t == null ? null : Math.round((t + leadIn) * 1000) / 1000,
              )
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
            src={blobUrl}
            startTime={entry.songStartTime}
            leadIn={leadIn}
            duration={duration}
            clipLength={clip ? clip.durationMs / 1000 : null}
            failed={failed}
            onScrub={setLiveStartRel}
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
