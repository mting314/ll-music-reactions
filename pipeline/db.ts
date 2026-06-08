// Shared Postgres connection for the pipeline + data API, using Bun's built-in
// SQL client (no external pg dependency).
//
// DATABASE_URL examples:
//   local:      postgres://user:pass@localhost:5432/llmusic
//   Cloud Run:  postgres://user:pass@/llmusic?host=/cloudsql/PROJECT:REGION:INSTANCE
import { SQL } from "bun";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set");
}

export const sql = new SQL(url);

// The entity tables and the id field used as their primary key in the canonical
// JSON. Shared by ingestion and the read API.
export const ENTITY_TABLES = {
  songs: "id",
  artists: "id",
  discographies: "id",
  series: "id",
  performances: "id",
  characters: "id",
} as const;
