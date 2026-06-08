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

async function buildDataset() {
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

let cache: { at: number; data: unknown } | null = null;

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
        if (!cache || Date.now() - cache.at > CACHE_TTL_MS) {
          cache = { at: Date.now(), data: await buildDataset() };
        }
        return Response.json(cache.data, {
          headers: { "Cache-Control": "public, max-age=300, s-maxage=3600", ...CORS },
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
