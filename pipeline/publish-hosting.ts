// Publishes the freshly-built dataset as a static `dataset.json` to Firebase
// Hosting's global CDN, so the frontend can fetch it from a nearby edge instead
// of a single-region dynamic API. Opt-in via PUBLISH_HOSTING=1 — a no-op
// otherwise, so the existing job is unaffected until the cutover.
import { $ } from "bun";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { Dataset } from "./build-dataset";
import { getProjectId } from "./firestore";

const HOSTING_DIR = join(import.meta.dir, "..", "public-data");

// Shape the built dataset into exactly what the frontend expects (the same shape
// the Cloud Run /data API returns): the entity arrays plus a `build` block.
// Note the top-level `generatedAt` from build-dataset is folded into `build`.
export function toPublishPayload(
  dataset: Dataset,
  counts: Record<string, number>,
) {
  return {
    songs: dataset.songs,
    artists: dataset.artists,
    discographies: dataset.discographies,
    seriesInfo: dataset.seriesInfo,
    seriesNames: dataset.seriesNames,
    performances: dataset.performances,
    setlists: dataset.setlists,
    build: { generatedAt: dataset.generatedAt, counts },
  };
}

// Write public-data/dataset.json and deploy it to Firebase Hosting. The repo-root
// firebase.json configures the public dir + headers (no-cache + CORS). Returns
// false (skips) unless PUBLISH_HOSTING=1.
//
// Auth: the deploy needs a service account with roles/firebasehosting.admin —
// provided via GOOGLE_APPLICATION_CREDENTIALS (a key file) or FIREBASE_TOKEN.
// (To be finalized against the live project at cutover.)
export async function publishToHosting(
  dataset: Dataset,
  counts: Record<string, number>,
): Promise<boolean> {
  if (process.env.PUBLISH_HOSTING !== "1") {
    console.log("PUBLISH_HOSTING != 1 — skipping Firebase Hosting publish.");
    return false;
  }
  const project = process.env.FIREBASE_PROJECT ?? (await getProjectId());

  await mkdir(HOSTING_DIR, { recursive: true });
  await writeFile(
    join(HOSTING_DIR, "dataset.json"),
    JSON.stringify(toPublishPayload(dataset, counts)),
  );

  // Deploys the default Hosting site (served at <project>.web.app). Run from the
  // repo root so it picks up firebase.json.
  await $`firebase deploy --only hosting --project ${project} --non-interactive`.cwd(
    join(import.meta.dir, ".."),
  );
  console.log(
    `Published dataset.json to Firebase Hosting (project ${project}).`,
  );
  return true;
}
