#!/usr/bin/env bash
# One-time GCP provisioning for the data pipeline.
#
# Creates: Cloud SQL (Postgres) instance + DB, the read-only data API
# (Cloud Run service), the daily refresh (Cloud Run Job), and a Cloud Scheduler
# cron that runs the job daily.
#
# This is NOT run automatically — Cloud SQL is a billable, always-on resource.
# Review, then run it yourself once the PR is approved. Re-running is mostly
# idempotent (it skips resources that already exist).
#
# Prereqs: gcloud authed, billing enabled, APIs: run, sqladmin, cloudscheduler,
# cloudbuild, artifactregistry.
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project)}"
REGION="${REGION:-us-central1}"
INSTANCE="${INSTANCE:-ll-data}"
DB_NAME="${DB_NAME:-llmusic}"
DB_USER="${DB_USER:-llmusic}"
DB_TIER="${DB_TIER:-db-f1-micro}"
SERVICE="${SERVICE:-ll-data-api}"
JOB="${JOB:-ll-data-refresh}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# A DB password must be provided (don't hardcode secrets).
: "${DB_PASSWORD:?Set DB_PASSWORD env var to a strong password}"

CONNECTION="${PROJECT}:${REGION}:${INSTANCE}"
# Cloud Run reaches Cloud SQL over a unix socket at /cloudsql/<connection>.
DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${CONNECTION}"

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com sqladmin.googleapis.com \
  cloudscheduler.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com --project "$PROJECT"

echo "==> Cloud SQL instance ($INSTANCE)"
if ! gcloud sql instances describe "$INSTANCE" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud sql instances create "$INSTANCE" \
    --project "$PROJECT" --region "$REGION" \
    --database-version POSTGRES_15 --tier "$DB_TIER" --storage-size 10
fi

echo "==> Database + user"
gcloud sql databases create "$DB_NAME" --instance "$INSTANCE" --project "$PROJECT" 2>/dev/null || true
gcloud sql users create "$DB_USER" --instance "$INSTANCE" --project "$PROJECT" \
  --password "$DB_PASSWORD" 2>/dev/null \
  || gcloud sql users set-password "$DB_USER" --instance "$INSTANCE" \
       --project "$PROJECT" --password "$DB_PASSWORD"

echo "==> Deploy data API (Cloud Run service)"
gcloud run deploy "$SERVICE" \
  --source "$REPO_ROOT/data-api" \
  --project "$PROJECT" --region "$REGION" \
  --allow-unauthenticated \
  --add-cloudsql-instances "$CONNECTION" \
  --set-env-vars "DATABASE_URL=${DATABASE_URL}" \
  --memory 512Mi

echo "==> Deploy refresh job (Cloud Run Job)"
gcloud run jobs deploy "$JOB" \
  --source "$REPO_ROOT/pipeline" \
  --project "$PROJECT" --region "$REGION" \
  --add-cloudsql-instances "$CONNECTION" \
  --set-env-vars "DATABASE_URL=${DATABASE_URL}" \
  --task-timeout 1800 --memory 1Gi

echo "==> Daily Cloud Scheduler trigger (03:00 UTC)"
SA="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
gcloud scheduler jobs create http "${JOB}-daily" \
  --project "$PROJECT" --location "$REGION" \
  --schedule "0 3 * * *" \
  --uri "https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run" \
  --http-method POST \
  --oauth-service-account-email "$SA" 2>/dev/null \
  || echo "  (scheduler job already exists)"

echo "==> Seed the DB from the committed snapshot (first time)"
echo "    Run locally with the Cloud SQL Auth Proxy, or trigger the job:"
echo "      gcloud run jobs execute $JOB --project $PROJECT --region $REGION"
echo ""
echo "Done. Set the frontend's VITE_DATA_API to the data API URL:"
gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
  --format 'value(status.url)' 2>/dev/null || true
