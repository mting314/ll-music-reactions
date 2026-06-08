// Writes an assembled Dataset into Firestore as native documents.
//
// Collections: songs, artists, discographies, series, performances, setlists.
// Plus a `meta` collection: meta/seriesNames and meta/build.
import { commitUpserts } from "./firestore";
import type { Dataset } from "./build-dataset";

type Doc = { collection: string; id: string; data: object };

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

  await commitUpserts(project, docs);
  return counts;
}
