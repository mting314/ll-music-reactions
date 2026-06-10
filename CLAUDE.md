# CLAUDE.md

Guidance for working in this repo.

## What this is

A web app for creating **Love Live music-reaction meme videos**: match songs from
the Love Live discography with reaction video clips, arrange them on a timeline
("builder"), and export a stitched MP4 with album-art overlays. Client-side SPA
deployed to **GitHub Pages**; video export and data are backed by small Cloud Run
services. Runs at ~$0/month.

## Stack & environment

- **React 19 + TypeScript**, **Vite 6**, **Tailwind CSS 4**, **@dnd-kit** (drag
  & drop), **wanakana** (JP romaji/kana search).
- **Bun is the runtime and package manager. There is NO Node on PATH.** Use
  `bun` / `bunx`, never `npm`/`node`. (The pipeline/data-api also run on Bun.)
- **Consequence:** the browser-automation MCP tool needs Node, so it can't run
  here — UI changes can't be auto-screenshotted. Verify UI via `bun run
  typecheck` + `bun run build` + tests + code review, and say so honestly.

## Commands

```bash
bun install
bun run dev          # vite dev server (localhost:5173); fetches live data
bun run typecheck    # tsc -b   (only type-checks src/; see Testing)
bun run lint         # eslint .
bun run test         # bun test server/ pipeline/ src/
bun run build        # tsc -b && vite build  (network-free; no data bundled)
```

## Architecture

### Data (catalog: songs/artists/discographies/series/performances/setlists)

The frontend **does not bundle any catalog data** — it fetches it at runtime, and
shows an **honest error (with Retry) if unreachable; never stale data** (a
deliberate consistency-over-availability choice).

```
scrapers (ll-fans.jp / lovelive-anime.jp, via private ll-sorter-scripts)
  → Cloud Run JOB (pipeline/, daily 03:00 UTC): scrape → build → publish
  → per-entity JSON pushed to the ll-music-data repo → GitHub Pages CDN
     (songs.json, artists.json, …, build.json)
  → frontend fetchDataset(VITE_DATA_BASE)  → DataProvider (context)  → hooks
```

There is **no database and no data API** — the daily Cloud Run job is the single
producer; it commits per-entity JSON straight to the `ll-music-data` repo (via a
GitHub token), and GitHub Pages serves it. (This replaced an earlier
Firestore + Cloud Run data-API + mirror-Action chain.)

- `VITE_DATA_BASE` (in `.env.production` / `.env.development`) = the CDN base
  (`https://mting314.github.io/ll-music-data`). The app fetches the per-entity
  files in parallel and assembles a `Dataset`.
- `src/data/fetchDataset.ts` — parallel fetch + timeout + abort + non-empty-songs
  guard. `src/context/DataProvider.tsx` — loading → data, or error+Retry.
- Reaction **clips** are app-owned assets and stay bundled (`clips-manifest.json`
  + `public/clips`), unlike the external catalog data.
- See `docs/` and `pipeline/README.md` for the full data pipeline.

### Builder (the timeline of clip+song entries)

- `useTimeline` — entries state with **autosave to localStorage** + undo/redo.
  Working draft survives reload (key `ll-music-reactions-timeline`).
- `EntryList` — the vertical list, **drag-reorderable** (@dnd-kit).
- Adding an entry opens the **song picker first** (no blank rows), then creates
  the entry from the chosen song; clip attached afterward per row.
- **Save / load named builds** + JSON export/import: `useSavedProjects` +
  `ProjectsPanel`. See `docs/saving-builds.md`.
- **Data viewer** tab (`DataViewer`) — read-only browse of the dataset + data-gap
  stats; toggled via the Header Builder/Data nav.
- Song search has full filtering (series / type[solo/unit/group] / artist / year),
  modeled on the-sorter: `useSongSearch` + `SongFilters` + `utils/filters.ts`.

### Video export

`server/export.ts` (Bun + ffmpeg) → Cloud Run service `ll-export`
(`VITE_EXPORT_API`). Streams SSE progress; returns a Discord-sized MP4.

## Project structure

```
src/            frontend (components/, hooks/, context/, data/, utils/, types/)
pipeline/       Cloud Run daily-refresh job: scrape → build → publish JSON
server/         ffmpeg video-export service (Bun)
docs/           architecture notes (e.g. saving-builds.md)
```
(The separate **ll-music-data** repo holds the published per-entity JSON, served
by GitHub Pages — the CDN the frontend reads. The pipeline job pushes to it.)

## Conventions

- TS strict; import alias **`@/` → `src/`**.
- **Tests:** `*.test.ts` colocated in `src/` (and `server/`, `pipeline/`), run by
  `bun test`. They are **excluded from `tsc`** (tsconfig `exclude`) because
  `bun:test` types aren't wired into the app tsconfig. **No DOM/component testing
  is set up** — extract pure logic into testable functions and unit-test those
  (e.g. `utils/filters.ts`, `useSavedProjects` helpers, `fetchDataset`).
- Match existing Tailwind styling (dark theme: `#0f0f1e` / `#1a1a2e`, pink-600
  accents).

## Deploy & workflow

- **Branch off `main`, open a PR, never commit feature work to `main`.**
- CI (`.github/workflows/ci.yml`) gates PRs on lint + typecheck + test + build.
- **Squash-merge**; pushing to `main` auto-deploys the frontend to GitHub Pages
  (`deploy.yml`). The build needs no network and bundles no data.
- The Cloud Run **data API** and **export** services deploy separately via
  `gcloud run deploy --source <dir>` (not in CI).
- Established habit this repo: run a **code review on the diff before merging**
  features, fix findings, then merge.

## Gotchas

- **Parse years from `releasedOn.substring(0,4)`**, not `new Date().getFullYear()`
  (local-time parsing buckets Jan-1 releases into the previous year for viewers
  behind UTC).
- **Album art** comes from Amazon product images; bonus/ticket releases with no
  Amazon listing legitimately have no art (the app shows a placeholder — not a
  bug). The Data viewer surfaces "songs without album art".
- Album-art `<img>` needs `crossOrigin="anonymous"` (COEP/CORP).
- GitHub Pages forces `Cache-Control: max-age=600` on the data files (can't set
  `no-cache`) — fine for once-daily data; ~10-min propagation after a refresh.
- GCP project: `future-name-201021` (= project number 278890546984).
