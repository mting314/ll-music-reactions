#!/usr/bin/env bash
# One-time GCP provisioning for the data pipeline (Firestore-based, ~$0/month).
#
# Creates: a Firestore (Native) database, the read-only data API (Cloud Run
# service) that serves the dataset from Firestore, the daily refresh (Cloud Run
# Job) that scrapes + writes Firestore, and a Cloud Scheduler cron.
#
# Review, then run once after the PR is approved. Re-running is mostly idempotent.
# Prereqs: gcloud authed, billing enabled.
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project)}"
REGION="${REGION:-us-central1}"
JOB="${JOB:-ll-data-refresh}"
SERVICE="${SERVICE:-ll-data-api}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# The scraper repo (hamzaabamboo/ll-sorter-scripts) is PRIVATE, so the job needs
# a GitHub token with read access to clone it. Stored in Secret Manager.
: "${GITHUB_TOKEN:?Set GITHUB_TOKEN to a GitHub PAT with read access to the scraper repo}"
SECRET="${SECRET:-ll-github-token}"

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com secretmanager.googleapis.com --project "$PROJECT"

echo "==> Firestore (Native) database"
gcloud firestore databases create --location "$REGION" --project "$PROJECT" 2>/dev/null \
  || echo "  (database already exists)"

echo "==> Store GitHub token in Secret Manager ($SECRET)"
gcloud secrets describe "$SECRET" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud secrets create "$SECRET" --project "$PROJECT" --replication-policy automatic
printf '%s' "$GITHUB_TOKEN" | gcloud secrets versions add "$SECRET" --project "$PROJECT" --data-file=-

echo "==> Grant the service account Firestore + secret + job-run access"
SA="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" --role=roles/datastore.user --condition=None >/dev/null
gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT" \
  --member="serviceAccount:${SA}" --role=roles/secretmanager.secretAccessor >/dev/null
# Lets Cloud Scheduler (running as this SA) trigger the Cloud Run Job.
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" --role=roles/run.developer --condition=None >/dev/null

echo "==> Deploy data API (Cloud Run service, reads Firestore)"
gcloud run deploy "$SERVICE" \
  --source "$REPO_ROOT/data-api" \
  --project "$PROJECT" --region "$REGION" \
  --allow-unauthenticated --memory 512Mi

echo "==> Deploy refresh job (Cloud Run Job, writes Firestore)"
gcloud run jobs deploy "$JOB" \
  --source "$REPO_ROOT/pipeline" \
  --project "$PROJECT" --region "$REGION" \
  --set-secrets "GITHUB_TOKEN=${SECRET}:latest" \
  --task-timeout 1800 --memory 1Gi

echo "==> Daily Cloud Scheduler trigger (03:00 UTC)"
gcloud scheduler jobs create http "${JOB}-daily" \
  --project "$PROJECT" --location "$REGION" \
  --schedule "0 3 * * *" \
  --uri "https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run" \
  --http-method POST --oauth-service-account-email "$SA" 2>/dev/null \
  || echo "  (scheduler job already exists)"

echo "==> Populate Firestore now"
gcloud run jobs execute "$JOB" --project "$PROJECT" --region "$REGION" --wait || true

echo ""
echo "Done. Point the frontend at the data API and redeploy Pages:"
gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --format 'value(status.url)' 2>/dev/null || true
echo "  .env.production -> VITE_DATA_API=<that URL>"
