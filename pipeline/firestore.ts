// Firestore access via the REST API (no gRPC SDK — works under Bun, no deps).
// Entities are stored as NATIVE Firestore fields (not JSON strings) so they're
// queryable per-record later.

// ---- JSON <-> Firestore typed-value conversion -----------------------------

type FsValue = Record<string, unknown>;

export function toFirestoreValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? { integerValue: String(v) }
      : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFirestoreValue) } };
  }
  if (typeof v === "object") {
    return { mapValue: { fields: toFirestoreFields(v as object) } };
  }
  return { stringValue: String(v) };
}

export function toFirestoreFields(obj: object): Record<string, FsValue> {
  const fields: Record<string, FsValue> = {};
  for (const [k, val] of Object.entries(obj)) {
    if (val === undefined) continue; // Firestore rejects undefined
    fields[k] = toFirestoreValue(val);
  }
  return fields;
}

export function fromFirestoreValue(v: FsValue): unknown {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) {
    const values = (v.arrayValue as { values?: FsValue[] }).values ?? [];
    return values.map(fromFirestoreValue);
  }
  if ("mapValue" in v) {
    return fromFirestoreFields(
      (v.mapValue as { fields?: Record<string, FsValue> }).fields ?? {},
    );
  }
  // timestampValue, etc. — not used by our data
  return null;
}

export function fromFirestoreFields(
  fields: Record<string, FsValue>,
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(fields)) obj[k] = fromFirestoreValue(val);
  return obj;
}

// ---- REST client -----------------------------------------------------------

const BASE = "https://firestore.googleapis.com/v1";

async function metadata(path: string): Promise<string> {
  const resp = await fetch(`http://metadata.google.internal/computeMetadata/v1/${path}`, {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!resp.ok) throw new Error(`metadata ${path} error ${resp.status}`);
  return resp.text();
}

export async function getProjectId(): Promise<string> {
  return process.env.FIRESTORE_PROJECT ?? metadata("project/project-id");
}

async function token(): Promise<string> {
  const resp = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!resp.ok) throw new Error(`token error ${resp.status}`);
  return ((await resp.json()) as { access_token: string }).access_token;
}

function docPath(project: string, collection: string, id: string): string {
  return `projects/${project}/databases/(default)/documents/${collection}/${id}`;
}

// Batch upsert documents (Firestore :commit allows up to 500 writes/request).
export async function commitUpserts(
  project: string,
  docs: { collection: string; id: string; data: object }[],
): Promise<void> {
  const auth = await token();
  for (let i = 0; i < docs.length; i += 500) {
    const batch = docs.slice(i, i + 500);
    const writes = batch.map((d) => ({
      update: {
        name: docPath(project, d.collection, d.id),
        fields: toFirestoreFields(d.data),
      },
    }));
    const resp = await fetch(
      `${BASE}/projects/${project}/databases/(default)/documents:commit`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ writes }),
      },
    );
    if (!resp.ok) throw new Error(`commit failed ${resp.status}: ${await resp.text()}`);
  }
}

interface FsDoc {
  name: string;
  fields?: Record<string, FsValue>;
}

// List all documents in a collection, returning { id, ...fields } objects.
export async function listCollection(
  project: string,
  collection: string,
): Promise<Record<string, unknown>[]> {
  const auth = await token();
  const out: Record<string, unknown>[] = [];
  let pageToken = "";
  do {
    const url = new URL(
      `${BASE}/projects/${project}/databases/(default)/documents/${collection}`,
    );
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${auth}` } });
    if (!resp.ok) throw new Error(`list ${collection} failed ${resp.status}`);
    const json = (await resp.json()) as { documents?: FsDoc[]; nextPageToken?: string };
    for (const doc of json.documents ?? []) {
      const id = doc.name.split("/").pop()!;
      out.push({ id, ...fromFirestoreFields(doc.fields ?? {}) });
    }
    pageToken = json.nextPageToken ?? "";
  } while (pageToken);
  return out;
}

// Fetch a single document's fields, or null if missing.
export async function getDoc(
  project: string,
  collection: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const auth = await token();
  const resp = await fetch(`${BASE}/${docPath(project, collection, id)}`, {
    headers: { Authorization: `Bearer ${auth}` },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`get ${collection}/${id} failed ${resp.status}`);
  const doc = (await resp.json()) as FsDoc;
  return fromFirestoreFields(doc.fields ?? {});
}
