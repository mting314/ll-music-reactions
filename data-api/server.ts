// Read-only Cloud Run service that serves the dataset from Firestore.
// The frontend fetches GET /data on load (see src/context/DataProvider.tsx).
//
// Self-contained (its own Firestore REST helpers) so it builds from this dir.
const PORT = Number(process.env.PORT ?? 8080);
const BASE = "https://firestore.googleapis.com/v1";
// Serve a cached snapshot for this many ms to limit Firestore reads.
const CACHE_TTL_MS = 5 * 60 * 1000;

// ---- Firestore REST (read + decode) ----------------------------------------

type FsValue = Record<string, unknown>;

function fromValue(v: FsValue): unknown {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) {
    const values = (v.arrayValue as { values?: FsValue[] }).values ?? [];
    return values.map(fromValue);
  }
  if ("mapValue" in v) {
    return fromFields((v.mapValue as { fields?: Record<string, FsValue> }).fields ?? {});
  }
  return null;
}

function fromFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(fields)) obj[k] = fromValue(val);
  return obj;
}

async function meta(path: string): Promise<string> {
  const r = await fetch(`http://metadata.google.internal/computeMetadata/v1/${path}`, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!r.ok) throw new Error(`metadata ${path} ${r.status}`);
  return r.text();
}
async function token(): Promise<string> {
  const r = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!r.ok) throw new Error(`token ${r.status}`);
  return ((await r.json()) as { access_token: string }).access_token;
}

let projectPromise: Promise<string> | null = null;
function projectId(): Promise<string> {
  if (!projectPromise) {
    projectPromise = Promise.resolve(
      process.env.FIRESTORE_PROJECT ?? meta("project/project-id"),
    );
  }
  return projectPromise;
}

interface FsDoc {
  name: string;
  fields?: Record<string, FsValue>;
}

async function listCollection(collection: string): Promise<Record<string, unknown>[]> {
  const [project, auth] = [await projectId(), await token()];
  const out: Record<string, unknown>[] = [];
  let pageToken = "";
  do {
    const url = new URL(
      `${BASE}/projects/${project}/databases/(default)/documents/${collection}`,
    );
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${auth}` } });
    if (!r.ok) throw new Error(`list ${collection} ${r.status}`);
    const json = (await r.json()) as { documents?: FsDoc[]; nextPageToken?: string };
    for (const d of json.documents ?? []) out.push(fromFields(d.fields ?? {}));
    pageToken = json.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

async function getDoc(collection: string, id: string): Promise<Record<string, unknown> | null> {
  const [project, auth] = [await projectId(), await token()];
  const r = await fetch(
    `${BASE}/projects/${project}/databases/(default)/documents/${collection}/${id}`,
    { headers: { Authorization: `Bearer ${auth}` } },
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`get ${collection}/${id} ${r.status}`);
  const doc = (await r.json()) as FsDoc;
  return fromFields(doc.fields ?? {});
}

// ---- dataset assembly (shape the frontend expects) -------------------------

// Fast path: read the pre-assembled snapshot (~4 doc reads) instead of every
// per-entity document (~3,100 reads). Returns null if no snapshot exists yet.
async function readSnapshot(): Promise<unknown | null> {
  const meta = await getDoc("snapshot", "meta");
  const n = meta?.chunks;
  if (typeof n !== "number" || n < 1) return null;
  const parts = await Promise.all(
    Array.from({ length: n }, (_, i) => getDoc("snapshot", String(i))),
  );
  if (parts.some((p) => !p || typeof p.part !== "string")) return null;
  try {
    return JSON.parse(parts.map((p) => p!.part as string).join(""));
  } catch {
    return null;
  }
}

async function buildDatasetFromCollections() {
  const [songs, artists, discographies, series, performances, setlistDocs, seriesNamesDoc, buildDoc] =
    await Promise.all([
      listCollection("songs"),
      listCollection("artists"),
      listCollection("discographies"),
      listCollection("series"),
      listCollection("performances"),
      listCollection("setlists"),
      getDoc("meta", "seriesNames"),
      getDoc("meta", "build"),
    ]);

  const setlists: Record<string, unknown> = {};
  for (const d of setlistDocs) setlists[String(d.id)] = d.setlist;

  return {
    songs,
    artists,
    discographies,
    seriesInfo: series,
    seriesNames: (seriesNamesDoc?.entries as Record<string, string>) ?? {},
    performances,
    setlists,
    build: buildDoc,
  };
}

type Raw = Record<string, unknown>;
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Raw) : {});

// Normalize either source (snapshot or per-collection) into one canonical
// shape: the dataset arrays plus a single `build: { generatedAt, counts }`.
// The snapshot carries top-level `generatedAt`; the collection path carries a
// `build` doc — this collapses both to the same response.
function normalize(d: Raw) {
  const songs = arr(d.songs);
  const artists = arr(d.artists);
  const discographies = arr(d.discographies);
  const seriesInfo = arr(d.seriesInfo);
  const performances = arr(d.performances);
  const setlists = obj(d.setlists);
  const counts = {
    songs: songs.length,
    artists: artists.length,
    discographies: discographies.length,
    series: seriesInfo.length,
    performances: performances.length,
    setlists: Object.keys(setlists).length,
  };
  const build =
    (d.build as Raw | undefined) ??
    (d.generatedAt ? { generatedAt: d.generatedAt, counts } : null);
  return {
    songs,
    artists,
    discographies,
    seriesInfo,
    seriesNames: obj(d.seriesNames),
    performances,
    setlists,
    build,
  };
}

// In-memory cache of the assembled payload, held in both serialized forms so we
// serialize and gzip once per refresh, not per request.
interface Payload {
  at: number;
  json: string;
  gzip: Uint8Array;
}
let cache: Payload | null = null;
// In-flight refresh, so a burst of requests against a cold/expired cache shares
// one Firestore assembly + compression instead of running one per request.
let inflight: Promise<Payload> | null = null;
// When a refresh fails, serve stale data and back off for this long instead of
// re-attempting on every request — so a Firestore outage degrades to "slightly
// stale" rather than a full outage + a retry storm against the failing backend.
let failedAt = 0;
const FAIL_COOLDOWN_MS = 30 * 1000;

async function refresh(): Promise<Payload> {
  // Cheap snapshot path first; fall back to per-collection assembly.
  // Normalize so both paths return the identical shape.
  const raw = (await readSnapshot()) ?? (await buildDatasetFromCollections());
  const json = JSON.stringify(normalize(raw as Record<string, unknown>));
  // App-layer gzip (~2 MB -> ~270 KB): the Google Frontend does NOT compress
  // this response, so we do it here. Bun.gzipSync is synchronous, but with the
  // in-flight lock it runs once per refresh (~13 ms). Default level — level 9
  // ~doubles CPU for only ~5% fewer bytes, not worth it for a reused result.
  const gzip = Bun.gzipSync(json, { level: 6 });
  cache = { at: Date.now(), json, gzip };
  return cache;
}

async function getPayload(): Promise<Payload> {
  const now = Date.now();
  if (cache && now - cache.at <= CACHE_TTL_MS) return cache;
  // Recently failed and we have something to serve: skip the retry, serve stale.
  if (cache && now - failedAt < FAIL_COOLDOWN_MS) return cache;
  if (!inflight) {
    inflight = refresh()
      .catch((err) => {
        failedAt = Date.now();
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
  }
  try {
    return await inflight;
  } catch (err) {
    // Refresh failed — serve the last-good payload rather than erroring out.
    // Only a cold cache (no prior successful load) surfaces the error as a 500.
    if (cache) return cache;
    throw err;
  }
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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
        const payload = await getPayload();
        // gzip shrinks this ~2 MB JSON to ~270 KB. Serve it when the client
        // advertises support; Vary keeps shared/browser caches correct since
        // the same URL can return either encoding.
        const acceptsGzip = (req.headers.get("accept-encoding") ?? "")
          .toLowerCase()
          .includes("gzip");
        const headers: Record<string, string> = {
          "Content-Type": "application/json;charset=utf-8",
          "Cache-Control": "public, max-age=300, s-maxage=3600",
          Vary: "Accept-Encoding",
          ...CORS,
        };
        if (acceptsGzip) {
          headers["Content-Encoding"] = "gzip";
          return new Response(payload.gzip, { headers });
        }
        return new Response(payload.json, { headers });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return Response.json({ error: message }, { status: 500, headers: CORS });
      }
    }
    return new Response("Not found", { status: 404, headers: CORS });
  },
});

console.log(`Data API listening on :${server.port}`);
