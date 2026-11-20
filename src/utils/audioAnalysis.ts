/**
 * Shared client-side audio fetch, decode, waveform, and automatic highlight
 * (chorus/hook) detection with two-level caching:
 *   1. Module-scoped in-memory cache (`analysisCache`) shared across EntryList,
 *      PreviewPlayer, and useVideoExport so each song URL is fetched & decoded
 *      at most once per session.
 *   2. Lightweight localStorage cache (`ll-music-reactions-auto-starts-v1`)
 *      persisting `{ leadIn, suggestedStart }` per URL (capped LRU) so repeat
 *      visits and exports resolve instantly without re-decoding.
 */
import { useEffect, useState } from 'react';
import { detectLeadIn, computePeaks } from '@/utils/audio';
import { detectHighlightStart } from '@/utils/highlight';
import type {
  HighlightWorkerRequest,
  HighlightWorkerResponse,
} from '@/utils/highlight.worker';

export interface AudioAnalysis {
  leadIn: number;
  duration: number;
  /** Auto-detected default start time in absolute file seconds, or null if unavailable. */
  suggestedStart: number | null;
  failed: boolean;
  // Object URL for the downloaded audio, reused for playback so the file is
  // fetched once (decode + <audio> share it) instead of downloaded twice.
  blobUrl: string | null;
  // Normalized waveform peaks (post-lead-in), for drawing the timeline.
  peaks: number[];
}

export interface StoredAutoStart {
  leadIn: number;
  suggestedStart: number;
}

// Waveform resolution — peaks per song. ~enough detail at the 8× max zoom
// without bloating the cached path string.
const WAVE_BUCKETS = 500;
const AUTO_START_STORAGE_KEY = 'll-music-reactions-auto-starts-v1';
const MAX_STORED_URLS = 500;

export const PENDING_ANALYSIS: AudioAnalysis = {
  leadIn: 0,
  duration: 0,
  suggestedStart: null,
  failed: false,
  blobUrl: null,
  peaks: [],
};

// ---- persistent auto-start cache (pure helpers exported for unit tests) ----

export function readAutoStartCache(
  storage: Pick<Storage, 'getItem'> | null = safeLocalStorage(),
): Record<string, StoredAutoStart> {
  if (!storage) return {};
  try {
    const raw = storage.getItem(AUTO_START_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, StoredAutoStart> = {};
    for (const [url, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        val &&
        typeof val === 'object' &&
        typeof (val as StoredAutoStart).leadIn === 'number' &&
        Number.isFinite((val as StoredAutoStart).leadIn) &&
        typeof (val as StoredAutoStart).suggestedStart === 'number' &&
        Number.isFinite((val as StoredAutoStart).suggestedStart)
      ) {
        out[url] = {
          leadIn: (val as StoredAutoStart).leadIn,
          suggestedStart: (val as StoredAutoStart).suggestedStart,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeAutoStartEntry(
  cache: Record<string, StoredAutoStart>,
  url: string,
  entry: StoredAutoStart,
  maxEntries: number = MAX_STORED_URLS,
  storage: Pick<Storage, 'setItem'> | null = safeLocalStorage(),
): Record<string, StoredAutoStart> {
  // Re-insert at the end to maintain rough LRU order via JS object insertion order
  const next: Record<string, StoredAutoStart> = { ...cache };
  delete next[url];
  next[url] = entry;

  const keys = Object.keys(next);
  if (keys.length > maxEntries) {
    const excess = keys.length - maxEntries;
    for (let i = 0; i < excess; i++) {
      delete next[keys[i]!];
    }
  }

  if (storage) {
    try {
      storage.setItem(AUTO_START_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota errors — in-memory cache still works
    }
  }
  return next;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

let storedAutoStarts: Record<string, StoredAutoStart> | null = null;
function getStoredMap(): Record<string, StoredAutoStart> {
  if (!storedAutoStarts) storedAutoStarts = readAutoStartCache();
  return storedAutoStarts;
}

/**
 * Synchronously return a cached suggested start time (absolute file seconds)
 * if this URL has already been analyzed in this session or a previous session.
 */
export function getCachedSuggestedStart(src: string | null | undefined): number | null {
  if (!src) return null;
  const mem = analysisCache.get(src);
  if (mem) return mem.suggestedStart;
  const persisted = getStoredMap()[src];
  return persisted ? persisted.suggestedStart : null;
}

// ---- shared AudioContext + highlight Web Worker ----------------------------

// A single shared AudioContext for ALL decodes. Browsers hard-cap the number of
// AudioContexts (~6 in Chrome) and throw once exceeded — creating one per row
// (doubled by StrictMode in dev) blows that limit and makes every decode fail.
// One shared, never-closed context sidesteps it.
let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (sharedAudioCtx) return sharedAudioCtx;
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  sharedAudioCtx = new Ctx();
  return sharedAudioCtx;
}

let highlightWorker: Worker | null = null;
let workerFailed = false;
let nextWorkerReqId = 1;
const workerPending = new Map<number, (suggestedStart: number) => void>();

function getHighlightWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (highlightWorker) return highlightWorker;
  try {
    highlightWorker = new Worker(
      new URL('./highlight.worker.ts', import.meta.url),
      { type: 'module' },
    );
    highlightWorker.onmessage = (ev: MessageEvent<HighlightWorkerResponse>) => {
      const resolve = workerPending.get(ev.data.id);
      if (resolve) {
        workerPending.delete(ev.data.id);
        resolve(ev.data.suggestedStart);
      }
    };
    highlightWorker.onerror = () => {
      workerFailed = true;
      highlightWorker?.terminate();
      highlightWorker = null;
      // Fail gracefully by resolving pending requests on main thread? We don't
      // retain buffers in workerPending, so callers time out / fall back via
      // the main-thread path on subsequent calls.
    };
    return highlightWorker;
  } catch {
    workerFailed = true;
    return null;
  }
}

function runHighlightDetection(
  channel: Float32Array,
  sampleRate: number,
  leadIn: number,
): Promise<number> {
  const worker = getHighlightWorker();
  if (!worker) {
    return Promise.resolve(detectHighlightStart(channel, sampleRate, { leadIn }));
  }

  // Copy into a dedicated transferable Float32Array so posting to the worker
  // is zero-copy transfer without detaching the AudioBuffer's backing store.
  const copy = new Float32Array(channel);
  const id = nextWorkerReqId++;

  return new Promise<number>((resolve) => {
    const onError = () => {
      if (workerPending.delete(id)) {
        resolve(detectHighlightStart(channel, sampleRate, { leadIn }));
      }
    };
    workerPending.set(id, (sec) => {
      worker.removeEventListener('error', onError);
      resolve(sec);
    });
    worker.addEventListener('error', onError, { once: true });
    const req: HighlightWorkerRequest = {
      id,
      samples: copy,
      sampleRate,
      leadIn,
    };
    try {
      worker.postMessage(req, [copy.buffer]);
    } catch {
      worker.removeEventListener('error', onError);
      workerPending.delete(id);
      resolve(detectHighlightStart(channel, sampleRate, { leadIn }));
    }
  });
}

// ---- main analysis pipeline ------------------------------------------------

// Decoded results are cached by URL (module scope) so a song is only ever
// fetched + decoded once — across rows, reorders, remounts, and duplicate songs.
const analysisCache = new Map<string, AudioAnalysis>();
const analysisInflight = new Map<string, Promise<AudioAnalysis>>();

/**
 * Fetch + decode a song's audio (Web Audio API) once, returning its leading
 * silence, exact duration, waveform peaks, and auto-detected chorus start time.
 * Result (incl. `failed`) is cached and in-flight requests are de-duped.
 */
export function analyzeAudio(src: string): Promise<AudioAnalysis> {
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
      const channel = buf.getChannelData(0);
      const leadIn = detectLeadIn(channel, buf.sampleRate);
      const peaks = computePeaks(
        channel,
        Math.floor(leadIn * buf.sampleRate),
        WAVE_BUCKETS,
      );

      // Reuse persisted suggestedStart when available to skip re-running FFTs;
      // otherwise detect off the main thread in the highlight Web Worker.
      const stored = getStoredMap()[src];
      let suggestedStart: number;
      if (stored && stored.suggestedStart < buf.duration) {
        suggestedStart = stored.suggestedStart;
      } else {
        suggestedStart = await runHighlightDetection(channel, buf.sampleRate, leadIn);
        storedAutoStarts = writeAutoStartEntry(getStoredMap(), src, {
          leadIn,
          suggestedStart,
        });
      }

      return {
        leadIn,
        duration: buf.duration,
        suggestedStart,
        failed: false,
        blobUrl: URL.createObjectURL(blob),
        peaks,
      };
    } catch {
      return {
        leadIn: 0,
        duration: 0,
        suggestedStart: null,
        failed: true,
        blobUrl: null,
        peaks: [],
      };
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
 * Resolve the auto-detected default start time (absolute file seconds) for a
 * song audio URL, returning immediately from cache when available or fetching
 * + analyzing on demand. Returns 0 if analysis fails.
 */
export async function resolveSuggestedStart(
  src: string | null | undefined,
): Promise<number> {
  if (!src) return 0;
  const cached = getCachedSuggestedStart(src);
  if (cached != null) return cached;
  const analysis = await analyzeAudio(src);
  return analysis.suggestedStart ?? analysis.leadIn ?? 0;
}

/**
 * Decode an already-fetched local `blob:` URL into an `AudioBuffer` using the
 * shared AudioContext (zero network traffic, respects browser AudioContext cap).
 */
export async function decodeBlobUrl(
  blobUrl: string,
): Promise<AudioBuffer | null> {
  const ctx = getAudioCtx();
  if (!ctx) return null;
  try {
    const resp = await fetch(blobUrl);
    if (!resp.ok) return null;
    return await ctx.decodeAudioData(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Lazily analyze a song's audio: the fetch + decode (a full ~MBs download per
 * song) only runs once `active` is true — wired to viewport visibility so a long
 * timeline doesn't decode every off-screen row up front. Cached results return
 * synchronously.
 */
export function useAudioAnalysis(
  src: string | null | undefined,
  active: boolean,
): AudioAnalysis {
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
