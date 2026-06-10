import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { type Dataset } from '@/data/dataset';
import { fetchDataset } from '@/data/fetchDataset';

const DataContext = createContext<Dataset | null>(null);

// The dataset is fetched at runtime from VITE_DATA_BASE — the base URL of the
// data CDN (the ll-music-data repo on GitHub Pages), under which the per-entity
// JSON files live. There is no bundled fallback by design: the app shows either
// current data or an honest error — never stale data.
const DATA_BASE = import.meta.env.VITE_DATA_BASE as string | undefined;

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
    if (!DATA_BASE) return;

    const controller = new AbortController();
    let cancelled = false;
    setError(null);
    setDataset(null);

    (async () => {
      try {
        const ds = await fetchDataset(DATA_BASE, { signal: controller.signal });
        if (!cancelled) setDataset(ds);
      } catch (err) {
        if (cancelled) return; // unmounted / superseded by a retry
        setError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [attempt]);

  // Build-time misconfiguration — retrying won't help, so don't offer it.
  if (!DATA_BASE) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0f0f1e] text-gray-300">
        <div className="max-w-sm text-center">
          <p className="mb-2 text-lg font-semibold text-white">
            Data service isn’t configured
          </p>
          <p className="text-sm text-gray-400">
            VITE_DATA_BASE is unset for this build.
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
