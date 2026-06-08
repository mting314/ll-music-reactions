// Read-only Cloud Run service that serves the dataset from Postgres.
// The frontend fetches GET /data on load (see src/context/DataProvider.tsx).
import { SQL } from "bun";

const PORT = Number(process.env.PORT ?? 8080);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
const sql = new SQL(databaseUrl);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Assemble the dataset in exactly the shape the frontend consumes.
async function getDataset() {
  const [
    songs,
    artists,
    discographies,
    seriesInfo,
    seriesNames,
    performances,
    setlistRows,
    builds,
  ] = await Promise.all([
    sql`SELECT data FROM songs`,
    sql`SELECT data FROM artists`,
    sql`SELECT data FROM discographies`,
    sql`SELECT data FROM series`,
    sql`SELECT name, english_name FROM series_names`,
    sql`SELECT data FROM performances`,
    sql`SELECT performance_id, data FROM setlists`,
    sql`SELECT finished_at, source_ref, counts FROM builds WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1`,
  ]);

  const setlists: Record<string, unknown> = {};
  for (const row of setlistRows) setlists[row.performance_id] = row.data;

  const seriesNameMap: Record<string, string> = {};
  for (const row of seriesNames) seriesNameMap[row.name] = row.english_name;

  return {
    songs: songs.map((r: { data: unknown }) => r.data),
    artists: artists.map((r: { data: unknown }) => r.data),
    discographies: discographies.map((r: { data: unknown }) => r.data),
    seriesInfo: seriesInfo.map((r: { data: unknown }) => r.data),
    seriesNames: seriesNameMap,
    performances: performances.map((r: { data: unknown }) => r.data),
    setlists,
    build: builds[0] ?? null,
  };
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 60,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (req.method === "GET" && pathname === "/health") {
      return new Response("ok", { headers: CORS });
    }

    if (req.method === "GET" && pathname === "/data") {
      try {
        const dataset = await getDataset();
        return Response.json(dataset, {
          headers: {
            // Cache at the CDN/browser; refreshed daily server-side.
            "Cache-Control": "public, max-age=300, s-maxage=3600",
            ...CORS,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json({ error: message }, { status: 500, headers: CORS });
      }
    }

    return new Response("Not found", { status: 404, headers: CORS });
  },
});

console.log(`Data API listening on :${server.port}`);
