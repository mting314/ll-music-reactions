// Writes an assembled Dataset into Firestore as native documents.
//
// Two representations are written:
//  - Per-entity collections (songs, artists, ...) — queryable per-record.
//  - A `snapshot` collection of a few <1 MiB chunks holding the full dataset
//    JSON — so the read API serves /data with ~4 document reads instead of
//    ~3,100 (Firestore docs cap at 1 MiB, hence chunking).
import { commitUpserts } from "./firestore";
import type { Dataset } from "./build-dataset";

type Doc = { collection: string; id: string; data: object };

// Max bytes per snapshot chunk. Firestore's hard limit is 1 MiB per document;
// stay well under to leave room for field overhead.
const CHUNK_BYTES = 900_000;

// Split a string into pieces each <= maxBytes of UTF-8, never breaking a
// multi-byte character (UTF-8 continuation bytes are 0b10xxxxxx).
export function chunkUtf8(s: string, maxBytes: number): string[] {
  const bytes = new TextEncoder().encode(s);
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + maxBytes, bytes.length);
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--; // back to boundary
    chunks.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  return chunks;
}

export async function loadDataset(
  project: string,
  dataset: Dataset,
): Promise<Record<string, number>> {
  const docs: Doc[] = [];

  const pushEntities = (collection: string, rows: Record<string, unknown>[]) => {
    for (const row of rows) docs.push({ collection, id: String(row.id), data: row });
  };

  pushEntities("songs", dataset.songs);
  pushEntities("artists", dataset.artists);
  pushEntities("discographies", dataset.discographies);
  pushEntities("series", dataset.seriesInfo);
  pushEntities("performances", dataset.performances);

  // setlists keyed by performance id
  for (const [pid, setlist] of Object.entries(dataset.setlists)) {
    docs.push({ collection: "setlists", id: pid, data: { id: pid, setlist } });
  }

  // meta docs: series name map + build info
  docs.push({
    collection: "meta",
    id: "seriesNames",
    data: { entries: dataset.seriesNames },
  });
  const counts = {
    songs: dataset.songs.length,
    artists: dataset.artists.length,
    discographies: dataset.discographies.length,
    series: dataset.seriesInfo.length,
    performances: dataset.performances.length,
    setlists: Object.keys(dataset.setlists).length,
  };
  docs.push({
    collection: "meta",
    id: "build",
    data: { generatedAt: dataset.generatedAt, counts },
  });

  // Write per-entity + meta docs.
  await commitUpserts(project, docs);

  // Write the consolidated snapshot (the cheap read path for /data).
  const chunks = chunkUtf8(JSON.stringify(dataset), CHUNK_BYTES);
  const snapshotDocs: Doc[] = chunks.map((part, i) => ({
    collection: "snapshot",
    id: String(i),
    data: { seq: i, part },
  }));
  snapshotDocs.push({
    collection: "snapshot",
    id: "meta",
    data: { chunks: chunks.length, generatedAt: dataset.generatedAt },
  });
  await commitUpserts(project, snapshotDocs);

  return counts;
}
