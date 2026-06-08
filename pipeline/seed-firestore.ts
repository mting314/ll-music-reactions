// Seed Firestore from an existing dataset.json snapshot — WITHOUT scraping.
// Useful for bootstrapping/restoring, and for validating the Firestore
// write→read path without re-running the (private) scrapers.
//
// Source (first match wins):
//   SEED_DATASET_GCS="bucket/object.json"   read from GCS (authenticated)
//   argv[2]                                  local file path
//   ./dataset.json                           default
import { accessToken, getProjectId } from "./firestore";
import { loadDataset } from "./load-firestore";
import type { Dataset } from "./build-dataset";

async function readFromGcs(spec: string): Promise<Dataset> {
  const slash = spec.indexOf("/");
  const bucket = spec.slice(0, slash);
  const object = spec.slice(slash + 1);
  const token = await accessToken();
  const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`GCS read failed ${resp.status}: ${await resp.text()}`);
  return (await resp.json()) as Dataset;
}

async function readDataset(): Promise<Dataset> {
  const gcs = process.env.SEED_DATASET_GCS;
  if (gcs) {
    console.log(`Reading dataset from gs://${gcs}`);
    return readFromGcs(gcs);
  }
  const path = process.argv[2] ?? "./dataset.json";
  console.log(`Reading dataset from ${path}`);
  return (await Bun.file(path).json()) as Dataset;
}

const dataset = await readDataset();
const project = await getProjectId();
console.log(`Seeding Firestore (project ${project})...`);
const counts = await loadDataset(project, dataset);
console.log("Seeded:", counts);
