import { toDataset, type Dataset } from './dataset';

const DEFAULT_TIMEOUT_MS = 15_000;

// The per-entity files published to the data CDN (the ll-music-data repo, served
// via GitHub Pages). Each field of the Dataset is its own file, fetched in
// parallel and reassembled — easier to inspect/serve, and sets up lazy loading.
const FILES = [
  'songs',
  'artists',
  'discographies',
  'seriesInfo',
  'seriesNames',
  'performances',
  'setlists',
  'build',
] as const;

export interface FetchDatasetOptions {
  // Abort the request after this long so a hung/cold CDN surfaces an error
  // instead of hanging forever.
  timeoutMs?: number;
  // Caller-controlled signal for lifecycle cancellation (e.g. React unmount/retry).
  signal?: AbortSignal;
}

// Fetches the per-entity JSON files from `baseUrl` (e.g. a GitHub Pages site) in
// parallel and assembles them into a Dataset. Throws on any HTTP error, an
// empty/invalid payload, or timeout — there is no bundled fallback, so callers
// surface these as an error state rather than showing stale data.
export async function fetchDataset(
  baseUrl: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, signal }: FetchDatasetOptions = {},
): Promise<Dataset> {
  const base = baseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Fold the caller's signal into our controller so either source aborts the fetch.
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const parts = await Promise.all(
      FILES.map(async (field) => {
        const resp = await fetch(`${base}/${field}.json`, {
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`${field}.json returned ${resp.status}`);
        return [field, await resp.json()] as const;
      }),
    );
    const raw = Object.fromEntries(parts) as Record<string, unknown>;
    // A missing/empty songs file would otherwise render a blank-but-not-errored
    // app; treat it as a failure instead.
    if (!Array.isArray(raw.songs) || raw.songs.length === 0) {
      throw new Error('Dataset has an empty or invalid songs file');
    }
    return toDataset(raw);
  } catch (err) {
    // Distinguish our timeout from a caller abort or a real fetch/parse error.
    if (timedOut) throw new Error('The data service timed out.');
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
