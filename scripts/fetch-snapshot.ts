// Fetches the live dataset from the Cloud Run data API and writes it to
// src/data/snapshot.json, which Vite bundles into the app at build time as the
// first-paint data and offline fallback (see src/data/dataset.ts).
//
// snapshot.json is gitignored: it is a build artifact, regenerated on every
// build/deploy, so the repo never carries stale data.
//
// Behavior:
//   - Skips the fetch if a snapshot exists and is <12h old (unless forced), so
//     local `dev`/`typecheck`/`build` don't hit the network every run.
//   - Set FORCE_SNAPSHOT=1 (CI does) to always fetch fresh.
//   - On fetch failure: keeps an existing snapshot when not forced; otherwise
//     exits non-zero so CI fails rather than shipping an empty app.

import {
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const SNAPSHOT_PATH = resolve(import.meta.dir, '../src/data/snapshot.json');
const ENV_PATH = resolve(import.meta.dir, '../.env.production');
const FRESH_MS = 12 * 60 * 60 * 1000; // 12h
const force = process.env.FORCE_SNAPSHOT === '1';

function fail(msg: string): never {
  console.error(`[fetch-snapshot] ${msg}`);
  process.exit(1);
}

function resolveApiUrl(): string | undefined {
  if (process.env.VITE_DATA_API) return process.env.VITE_DATA_API;
  if (!existsSync(ENV_PATH)) return undefined;
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^\s*VITE_DATA_API\s*=\s*(.+?)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  return undefined;
}

function snapshotIsFresh(): boolean {
  return (
    existsSync(SNAPSHOT_PATH) &&
    Date.now() - statSync(SNAPSHOT_PATH).mtimeMs < FRESH_MS
  );
}

// Fast path: recent snapshot already on disk and we weren't told to refresh.
if (!force && snapshotIsFresh()) {
  console.log('[fetch-snapshot] snapshot.json is fresh — skipping fetch.');
  process.exit(0);
}

const api = resolveApiUrl();
if (!api) {
  if (existsSync(SNAPSHOT_PATH) && !force) {
    console.warn(
      '[fetch-snapshot] VITE_DATA_API not set — keeping existing snapshot.json.',
    );
    process.exit(0);
  }
  fail('VITE_DATA_API not set and no existing snapshot.json to fall back to.');
}

const url = `${api.replace(/\/$/, '')}/data`;
console.log(`[fetch-snapshot] Fetching ${url} …`);

try {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = (await resp.json()) as { songs?: unknown };
  // Sanity-check the payload so we never bake a garbage/empty snapshot. A valid
  // shape with zero songs is treated as a bad refresh, not a real dataset.
  if (
    !json ||
    typeof json !== 'object' ||
    !Array.isArray(json.songs) ||
    json.songs.length === 0
  ) {
    throw new Error('payload missing a non-empty "songs" array');
  }
  const body = JSON.stringify(json);
  // Write atomically (temp + rename) so a crash mid-write can't leave a
  // truncated snapshot that a later run would treat as a valid fresh file.
  const tmp = `${SNAPSHOT_PATH}.tmp`;
  writeFileSync(tmp, body);
  renameSync(tmp, SNAPSHOT_PATH);
  console.log(
    `[fetch-snapshot] Wrote snapshot.json (${Math.round(
      Buffer.byteLength(body) / 1024,
    )} KB, ${json.songs.length} songs).`,
  );
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (existsSync(SNAPSHOT_PATH) && !force) {
    console.warn(
      `[fetch-snapshot] Fetch failed (${msg}) — keeping existing snapshot.json.`,
    );
    process.exit(0);
  }
  fail(`Fetch failed (${msg}) and no usable snapshot to fall back to. Aborting.`);
}
