// Assembles the canonical JSON data files into the single dataset object the
// frontend consumes (see src/data/dataset.ts), and writes it either to GCS
// (the daily job) or to a local file (for testing/seeding).
//
// Usage:
//   bun run build-dataset.ts <dataDir> --out ./dataset.json   # local file
//   bun run build-dataset.ts <dataDir> --bucket my-bucket     # upload to GCS
import { join } from "path";
import { uploadJson } from "./gcs";

type Json = Record<string, unknown>;

// Object name written to the bucket; the frontend fetches this.
export const DATASET_OBJECT = "dataset.json";

async function readJson<T>(dir: string, file: string, fallback: T): Promise<T> {
  const f = Bun.file(join(dir, file));
  if (!(await f.exists())) {
    console.warn(`  skip (missing): ${file}`);
    return fallback;
  }
  return (await f.json()) as T;
}

export interface Dataset {
  songs: Json[];
  artists: Json[];
  discographies: Json[];
  seriesInfo: Json[];
  seriesNames: Record<string, string>;
  performances: Json[];
  setlists: Record<string, unknown>;
  generatedAt: string;
}

export async function buildDataset(
  dataDir: string,
  generatedAt: string,
): Promise<Dataset> {
  return {
    songs: await readJson<Json[]>(dataDir, "song-info.json", []),
    artists: await readJson<Json[]>(dataDir, "artists-info.json", []),
    discographies: await readJson<Json[]>(dataDir, "discography-info.json", []),
    seriesInfo: await readJson<Json[]>(dataDir, "series-info.json", []),
    seriesNames: await readJson<Record<string, string>>(dataDir, "series.json", {}),
    performances: await readJson<Json[]>(dataDir, "performance-info.json", []),
    setlists: await readJson<Record<string, unknown>>(
      dataDir,
      "performance-setlists.json",
      {},
    ),
    generatedAt,
  };
}

export function datasetCounts(d: Dataset): Record<string, number> {
  return {
    songs: d.songs.length,
    artists: d.artists.length,
    discographies: d.discographies.length,
    series: d.seriesInfo.length,
    performances: d.performances.length,
    setlists: Object.keys(d.setlists).length,
  };
}

// CLI: build from a data dir and write locally or to GCS.
if (import.meta.main) {
  const args = process.argv.slice(2);
  const dataDir = args[0] ?? join(import.meta.dir, "..", "src", "data");
  const outIdx = args.indexOf("--out");
  const bucketIdx = args.indexOf("--bucket");
  // Stable timestamp passed in by the caller, or now for local builds.
  const generatedAt = process.env.GENERATED_AT ?? new Date().toISOString();

  const dataset = await buildDataset(dataDir, generatedAt);
  console.log("Built dataset:", datasetCounts(dataset));

  if (bucketIdx !== -1) {
    const bucket = args[bucketIdx + 1]!;
    await uploadJson(bucket, DATASET_OBJECT, dataset);
    console.log(`Uploaded gs://${bucket}/${DATASET_OBJECT}`);
  } else {
    const out = outIdx !== -1 ? args[outIdx + 1]! : "./dataset.json";
    await Bun.write(out, JSON.stringify(dataset));
    console.log(`Wrote ${out}`);
  }
}
