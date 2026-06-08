# Data pipeline (GCP)

Replaces the hardcoded `src/data/*.json` imports with a **Firestore** database
that is **refreshed daily** using the same scraper scripts as
[`hamzaabamboo/ll-sorter-scripts`](https://github.com/hamzaabamboo/ll-sorter-scripts).

Firestore stores each entity as a **native document** (queryable per-record),
and is ~$0/month at this scale (free tier). A Cloud Run **data API** reads it
server-side and serves the dataset to the frontend (so the browser never needs
the Firebase SDK).

## Architecture

```
Cloud Scheduler (daily 03:00 UTC)
        │  POST :run
        ▼
Cloud Run Job  ── clone upstream scrapers (pinned, private → token) + seed
 (ll-data-refresh) ── run update.ts (DATA_ONLY) + parse-discography
        │             ── write native docs to Firestore
        ▼
Firestore (collections: songs, artists, discographies, series,
           performances, setlists, meta/{seriesNames,build})
        ▲
        │  REST read (cached)
Cloud Run Service (ll-data-api)  ──  GET /data  ──►  Frontend (DataProvider)
```

The frontend fetches `GET /data` when `VITE_DATA_API` is set; otherwise it falls
back to the bundled `src/data` snapshot, so the app always works (and the live
site is unaffected until provisioned).

## Pieces

| Path | What |
|------|------|
| `firestore.ts` | Firestore REST client + JSON↔native-value converter (no SDK) |
| `build-dataset.ts` | Assemble canonical JSON → one dataset object |
| `load-firestore.ts` | Write the dataset into Firestore collections (batched) |
| `run-refresh.ts` | Daily job: clone+run scrapers, build dataset, write Firestore |
| `Dockerfile` | Cloud Run Job image (Bun + git) |
| `../data-api/server.ts` | Cloud Run service: reads Firestore, serves `GET /data` |
| `setup-gcp.sh` | One-time provisioning (Firestore, service, job, scheduler) |

## Why per-record documents

Each song/artist/etc. is a real Firestore document (native typed fields, not a
JSON blob), so you can later run server-side queries
(e.g. `where('seriesIds','array-contains', x)`) and add filtered API endpoints
without re-modeling the data. `firestore.test.ts` verifies the encode/decode
round-trips on real entity shapes.

## ⚠️ The scraper repo is private

`ll-sorter-scripts` is **private**, so the Cloud Run Job needs a **GitHub token**
(read access) to clone it. `setup-gcp.sh` stores it in Secret Manager; the job
reads it as `GITHUB_TOKEN` (redacted from all logs). The public
`hamproductions/the-sorter` seed repo needs no token.

## Setup (run once, after review)

```bash
export GITHUB_TOKEN='<PAT with read access to ll-sorter-scripts>'
./pipeline/setup-gcp.sh     # Firestore + secret + service + job + scheduler, runs job once
# then point the frontend at the data API and redeploy Pages:
#   .env.production -> VITE_DATA_API=https://ll-data-api-XXXX.us-central1.run.app
```

## Local development

```bash
cd pipeline && bun install
bun run build:local         # assemble src/data -> ./dataset.json (no network)
bun test ../pipeline        # converter round-trip tests
```

## ⚠️ Validation note

The converter, dataset assembly, data API shape, and frontend wiring are
verified by CI / local tests. The **scrape step** hits external sites and
depends on the upstream repos' layout, so it's validated in the live Cloud Run
Job (the full scrape + wiki pull has been run successfully end-to-end).
