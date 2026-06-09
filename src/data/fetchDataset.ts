import { toDataset, type Dataset } from './dataset';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface FetchDatasetOptions {
  // Abort the request after this long so a hung/cold-starting API surfaces an
  // error instead of hanging forever.
  timeoutMs?: number;
  // Caller-controlled signal for lifecycle cancellation (e.g. React unmount/retry).
  signal?: AbortSignal;
}

// Fetches the dataset JSON from `dataUrl` at runtime. The URL can point at the
// Cloud Run data API (`…/data`) or a static file on a CDN (e.g. Firebase Hosting
// `…/dataset.json`) — both return the same dataset shape, so cutover is just an
// env change. Throws on HTTP error, an empty/invalid payload, or timeout; there
// is no bundled fallback, so callers surface these as an error state.
export async function fetchDataset(
  dataUrl: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, signal }: FetchDatasetOptions = {},
): Promise<Dataset> {
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
    const resp = await fetch(dataUrl, { signal: controller.signal });
    if (!resp.ok) throw new Error(`Data API returned ${resp.status}`);
    const json = (await resp.json()) as { songs?: unknown };
    // A 200 with an empty/invalid body would otherwise render a blank-but-not-
    // errored app; treat it as a failure instead.
    if (!Array.isArray(json.songs) || json.songs.length === 0) {
      throw new Error('Data API returned an empty or invalid dataset');
    }
    return toDataset(json);
  } catch (err) {
    // Distinguish our timeout from a caller abort or a real fetch/parse error.
    if (timedOut) throw new Error('The data service timed out.');
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}
