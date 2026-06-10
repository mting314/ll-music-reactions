// Publishes the freshly-built dataset as per-entity JSON straight to the data
// repo (served via GitHub Pages), replacing the old Firestore + data-api +
// mirror-Action path. Single source of truth: scrape -> build -> publish.
import { $ } from "bun";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { Dataset } from "./build-dataset";

// Data repo (no protocol/.git). The job pushes with x-access-token + GITHUB_TOKEN.
const DATA_REPO = process.env.DATA_REPO ?? "github.com/mting314/ll-music-data";

// Split the dataset into the per-entity files the frontend fetches (each Dataset
// field is its own file, plus build.json). Pure → unit-tested.
export function toPublishFiles(
  dataset: Dataset,
  counts: Record<string, number>,
): Record<string, unknown> {
  return {
    "songs.json": dataset.songs,
    "artists.json": dataset.artists,
    "discographies.json": dataset.discographies,
    "seriesInfo.json": dataset.seriesInfo,
    "seriesNames.json": dataset.seriesNames,
    "performances.json": dataset.performances,
    "setlists.json": dataset.setlists,
    "build.json": { generatedAt: dataset.generatedAt, counts },
  };
}

export async function publishData(
  dataset: Dataset,
  counts: Record<string, number>,
): Promise<void> {
  // Never publish an empty/partial scrape — it would overwrite the good JSON and
  // (via the frontend's non-empty-songs guard) take the live site down until the
  // next good run. Fail instead; the data repo keeps its last-good files.
  if (!dataset.songs?.length) {
    throw new Error(
      "refusing to publish: dataset has no songs (likely a partial/failed scrape)",
    );
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required to publish to the data repo");

  const dir = await mkdtemp(join(tmpdir(), "ll-data-"));
  try {
    const url = `https://x-access-token:${token}@${DATA_REPO}.git`;
    await $`git clone --depth 1 ${url} ${dir}`.quiet();

    for (const [name, value] of Object.entries(toPublishFiles(dataset, counts))) {
      await writeFile(join(dir, name), JSON.stringify(value));
    }

    await $`git -C ${dir} add -A`.quiet();
    const status = (await $`git -C ${dir} status --porcelain`.quiet().text()).trim();
    if (!status) {
      console.log("Data unchanged — nothing to publish.");
      return;
    }
    const msg = `data: refresh ${dataset.generatedAt}`;
    await $`git -C ${dir} -c user.name=ll-data-bot -c user.email=ll-data-bot@users.noreply.github.com commit -m ${msg}`.quiet();
    await $`git -C ${dir} push`.quiet();
    console.log("Published per-entity JSON to the data repo.");
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
