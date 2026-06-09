import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { toDataset, type Dataset } from '@/data/dataset';

const DataContext = createContext<Dataset | null>(null);

// The dataset is fetched from the Cloud Run data API (Firestore-backed, refreshed
// daily) at runtime. There is no bundled fallback by design: the app shows either
// current data or an honest error — never stale data.
const DATA_API = import.meta.env.VITE_DATA_API as string | undefined;
// Bound the wait so a hung/cold-starting API surfaces an error + Retry instead of
// an indefinite spinner.
const FETCH_TIMEOUT_MS = 15_000;

export function useDataset(): Dataset {
  const dataset = useContext(DataContext);
  if (!dataset) {
    throw new Error('useDataset must be used within <DataProvider>');
  }
  return dataset;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bump to retry the fetch after a failure.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Misconfiguration is handled in render (Retry can't fix a missing URL).
    if (!DATA_API) return;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let cancelled = false;
    setError(null);
    setDataset(null);

    (async () => {
      try {
        const resp = await fetch(`${DATA_API.replace(/\/$/, '')}/data`, {
          signal: controller.signal,
        });
        if (!resp.ok) throw new Error(`Data API returned ${resp.status}`);
        const json = (await resp.json()) as { songs?: unknown };
        // A 200 with an empty/invalid body would otherwise render a blank-but-
        // not-errored app; treat it as a failure instead.
        if (!Array.isArray(json.songs) || json.songs.length === 0) {
          throw new Error('Data API returned an empty or invalid dataset');
        }
        if (!cancelled) setDataset(toDataset(json));
      } catch (err) {
        if (cancelled) return;
        setError(
          controller.signal.aborted
            ? 'The data service timed out.'
            : err instanceof Error
              ? err.message
              : String(err),
        );
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt]);

  // Build-time misconfiguration — retrying won't help, so don't offer it.
  if (!DATA_API) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0f0f1e] text-gray-300">
        <div className="max-w-sm text-center">
          <p className="mb-2 text-lg font-semibold text-white">
            Data service isn’t configured
          </p>
          <p className="text-sm text-gray-400">
            VITE_DATA_API is unset for this build.
          </p>
        </div>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0f0f1e] text-gray-300">
        <div className="max-w-sm text-center">
          <p className="mb-2 text-lg font-semibold text-white">
            Couldn’t load Love Live data
          </p>
          <p className="mb-5 text-sm text-gray-400">
            The data service is unreachable right now. Please try again.
          </p>
          <button
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
            className="rounded-lg bg-pink-600 px-5 py-2 text-sm font-medium text-white hover:bg-pink-500"
          >
            Retry
          </button>
          <p className="mt-4 text-xs text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0f0f1e] text-gray-400">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-pink-600 border-t-transparent" />
          <p className="text-sm">Loading Love Live data…</p>
        </div>
      </div>
    );
  }

  return <DataContext.Provider value={dataset}>{children}</DataContext.Provider>;
}
