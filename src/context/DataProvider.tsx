import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { bundledDataset, toDataset, type Dataset } from '@/data/dataset';

const DataContext = createContext<Dataset | null>(null);

// Source of the dataset. When VITE_DATA_API is set (the Cloud Run data API
// backed by Firestore, refreshed daily), the app fetches it at runtime;
// otherwise it uses the bundled snapshot.
const DATA_API = import.meta.env.VITE_DATA_API as string | undefined;

export function useDataset(): Dataset {
  const dataset = useContext(DataContext);
  if (!dataset) {
    throw new Error('useDataset must be used within <DataProvider>');
  }
  return dataset;
}

export function DataProvider({ children }: { children: ReactNode }) {
  // Paint immediately from the bundled snapshot — it's baked into the JS at build
  // time from the data API (fresh as of last deploy) and served via GitHub Pages'
  // CDN, so it's fast worldwide (incl. Japan) with no cross-region API round trip.
  // When an API is configured, refresh in the background and swap in live data;
  // the user never waits on the network for first paint.
  const [dataset, setDataset] = useState<Dataset>(bundledDataset);

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
        // Background refresh failed — keep the bundled snapshot already on screen.
        console.warn('Remote data refresh failed, keeping bundled data:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return <DataContext.Provider value={dataset}>{children}</DataContext.Provider>;
}
