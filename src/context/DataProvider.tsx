import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { bundledDataset, toDataset, type Dataset } from '@/data/dataset';

const DataContext = createContext<Dataset | null>(null);

// Source of the dataset. When VITE_DATA_API is set, the app fetches the
// DB-backed dataset at runtime; otherwise it uses the bundled snapshot.
const DATA_API = import.meta.env.VITE_DATA_API as string | undefined;

export function useDataset(): Dataset {
  const dataset = useContext(DataContext);
  if (!dataset) {
    throw new Error('useDataset must be used within <DataProvider>');
  }
  return dataset;
}

export function DataProvider({ children }: { children: ReactNode }) {
  // When no API is configured, render synchronously from the bundled snapshot
  // (no loading state) — preserves current behavior.
  const [dataset, setDataset] = useState<Dataset | null>(
    DATA_API ? null : bundledDataset,
  );

  useEffect(() => {
    if (!DATA_API) return;
    let cancelled = false;

    (async () => {
      try {
        const resp = await fetch(`${DATA_API.replace(/\/$/, '')}/data`);
        if (!resp.ok) throw new Error(`Data API ${resp.status}`);
        const json = await resp.json();
        if (!cancelled) setDataset(toDataset(json));
      } catch (err) {
        // Network/API failure should never blank the app — fall back.
        console.warn('Data API unavailable, using bundled data:', err);
        if (!cancelled) setDataset(bundledDataset);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
