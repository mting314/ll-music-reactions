// Loads canonical JSON data files into Postgres.
//
// "Canonical" = the exact shapes the frontend consumes (the files currently in
// src/data). The daily refresh produces these from the scraper output; this
// module is also used to seed the DB from the committed src/data snapshot.
//
// Usage: bun run pipeline/load-to-db.ts [dataDir]   (default: src/data)
import { join } from "path";
import { sql } from "./db";

type Json = Record<string, unknown>;

async function readJson<T>(dir: string, file: string): Promise<T | null> {
  const path = join(dir, file);
  const f = Bun.file(path);
  if (!(await f.exists())) {
    console.warn(`  skip (missing): ${file}`);
    return null;
  }
  return (await f.json()) as T;
}

// Upsert an array of objects keyed by `idField` into a (id, data) table.
async function upsertEntities(
  table: string,
  rows: Json[],
  idField = "id",
): Promise<number> {
  if (rows.length === 0) return 0;
  await sql.begin(async (tx) => {
    for (const row of rows) {
      const id = String(row[idField]);
      await tx`
        INSERT INTO ${sql(table)} (id, data, updated_at)
        VALUES (${id}, ${JSON.stringify(row)}::jsonb, now())
        ON CONFLICT (id) DO UPDATE
          SET data = EXCLUDED.data, updated_at = now()
      `;
    }
  });
  return rows.length;
}

export interface LoadCounts {
  [entity: string]: number;
}

export async function loadDataDir(dataDir: string): Promise<LoadCounts> {
  const counts: LoadCounts = {};

  const songs = await readJson<Json[]>(dataDir, "song-info.json");
  if (songs) counts.songs = await upsertEntities("songs", songs);

  const artists = await readJson<Json[]>(dataDir, "artists-info.json");
  if (artists) counts.artists = await upsertEntities("artists", artists);

  const discographies = await readJson<Json[]>(dataDir, "discography-info.json");
  if (discographies)
    counts.discographies = await upsertEntities("discographies", discographies);

  const seriesInfo = await readJson<Json[]>(dataDir, "series-info.json");
  if (seriesInfo) counts.series = await upsertEntities("series", seriesInfo);

  const characters = await readJson<Json[]>(dataDir, "character-info.json");
  if (characters)
    counts.characters = await upsertEntities("characters", characters);

  const performances = await readJson<Json[]>(dataDir, "performance-info.json");
  if (performances)
    counts.performances = await upsertEntities("performances", performances);

  // series.json: { [jpName]: englishName }
  const seriesNames = await readJson<Record<string, string>>(
    dataDir,
    "series.json",
  );
  if (seriesNames) {
    const entries = Object.entries(seriesNames);
    await sql.begin(async (tx) => {
      for (const [name, english] of entries) {
        await tx`
          INSERT INTO series_names (name, english_name, updated_at)
          VALUES (${name}, ${english}, now())
          ON CONFLICT (name) DO UPDATE
            SET english_name = EXCLUDED.english_name, updated_at = now()
        `;
      }
    });
    counts.series_names = entries.length;
  }

  // performance-setlists.json: { [performanceId]: Setlist }
  const setlists = await readJson<Record<string, Json>>(
    dataDir,
    "performance-setlists.json",
  );
  if (setlists) {
    const entries = Object.entries(setlists);
    await sql.begin(async (tx) => {
      for (const [pid, setlist] of entries) {
        await tx`
          INSERT INTO setlists (performance_id, data, updated_at)
          VALUES (${pid}, ${JSON.stringify(setlist)}::jsonb, now())
          ON CONFLICT (performance_id) DO UPDATE
            SET data = EXCLUDED.data, updated_at = now()
        `;
      }
    });
    counts.setlists = entries.length;
  }

  return counts;
}

// Run directly: load a directory (default src/data) into the DB.
if (import.meta.main) {
  const dataDir = process.argv[2] ?? join(import.meta.dir, "..", "src", "data");
  console.log(`Loading data from ${dataDir} ...`);
  const counts = await loadDataDir(dataDir);
  console.log("Loaded:", counts);
  await sql.end();
}
