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
    if (!DATA_API) {
      setError('Data API not configured (VITE_DATA_API is unset).');
      return;
    }

    let cancelled = false;
    setError(null);
    setDataset(null);

    (async () => {
      try {
        const resp = await fetch(`${DATA_API.replace(/\/$/, '')}/data`);
        if (!resp.ok) throw new Error(`Data API returned ${resp.status}`);
        const json = await resp.json();
        if (!cancelled) setDataset(toDataset(json));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

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
            onClick={() => setAttempt((n) => n + 1)}
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
