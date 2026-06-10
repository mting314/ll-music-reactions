#!/usr/bin/env bash
# One-time GCP provisioning for the data pipeline (~$0/month).
#
# Creates: the daily refresh (Cloud Run Job) that scrapes the catalog, builds the
# dataset, and PUBLISHES per-entity JSON to the data repo (ll-music-data, served
# by GitHub Pages), plus a Cloud Scheduler cron. No database, no data API.
#
# Review, then run once. Re-running is mostly idempotent.
# Prereqs: gcloud authed, billing enabled.
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project)}"
REGION="${REGION:-us-central1}"
JOB="${JOB:-ll-data-refresh}"
DATA_REPO="${DATA_REPO:-github.com/mting314/ll-music-data}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# The job needs a GitHub PAT that can (a) READ the private scraper repo
# (hamzaabamboo/ll-sorter-scripts) to clone it, and (b) WRITE the data repo
# ($DATA_REPO) to push the published JSON. Stored in Secret Manager.
: "${GITHUB_TOKEN:?Set GITHUB_TOKEN to a PAT with read on the scraper repo and write on the data repo}"
SECRET="${SECRET:-ll-github-token}"

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com --project "$PROJECT"

echo "==> Store GitHub token in Secret Manager ($SECRET)"
gcloud secrets describe "$SECRET" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud secrets create "$SECRET" --project "$PROJECT" --replication-policy automatic
printf '%s' "$GITHUB_TOKEN" | gcloud secrets versions add "$SECRET" --project "$PROJECT" --data-file=-

echo "==> Grant the service account secret + job-run access"
SA="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT" \
  --member="serviceAccount:${SA}" --role=roles/secretmanager.secretAccessor >/dev/null
# Lets Cloud Scheduler (running as this SA) trigger the Cloud Run Job.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" --role=roles/run.developer --condition=None >/dev/null

echo "==> Deploy refresh job (scrapes + publishes JSON to $DATA_REPO)"
gcloud run jobs deploy "$JOB" \
  --source "$REPO_ROOT/pipeline" \
  --project "$PROJECT" --region "$REGION" \
  --set-secrets "GITHUB_TOKEN=${SECRET}:latest" \
  --set-env-vars "DATA_REPO=${DATA_REPO}" \
  --task-timeout 1800 --memory 1Gi

echo "==> Daily Cloud Scheduler trigger (03:00 UTC)"
gcloud scheduler jobs create http "${JOB}-daily" \
  --project "$PROJECT" --location "$REGION" \
  --schedule "0 3 * * *" \
  --uri "https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run" \
  --http-method POST --oauth-service-account-email "$SA" 2>/dev/null \
  || echo "  (scheduler job already exists)"

echo "==> Publish now (runs the job once)"
gcloud run jobs execute "$JOB" --project "$PROJECT" --region "$REGION" --wait || true

echo ""
echo "Done. The job publishes per-entity JSON to https://${DATA_REPO} (GitHub Pages)."
echo "The frontend already reads it via VITE_DATA_BASE (.env.production)."
