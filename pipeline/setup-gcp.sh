#!/usr/bin/env bash
# One-time GCP provisioning for the data pipeline (GCS-based, ~$0/month).
#
# Creates: a public GCS bucket for the dataset, the daily refresh (Cloud Run
# Job) that writes dataset.json to it, and a Cloud Scheduler cron. The frontend
# fetches the dataset object directly (CDN-cached) — no always-on DB/service.
#
# Review, then run once after the PR is approved. Re-running is mostly idempotent.
# Prereqs: gcloud authed, billing enabled.
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project)}"
REGION="${REGION:-us-central1}"
BUCKET="${BUCKET:-${PROJECT}-ll-data}"
JOB="${JOB:-ll-data-refresh}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com \
  storage.googleapis.com --project "$PROJECT"

echo "==> GCS bucket (gs://$BUCKET)"
if ! gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUCKET" \
    --project "$PROJECT" --location "$REGION" --uniform-bucket-level-access
fi

echo "==> Make objects public-readable (data is public anyway)"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member=allUsers --role=roles/storage.objectViewer --project "$PROJECT"

echo "==> CORS: allow browsers to fetch the dataset"
CORS_FILE="$(mktemp)"
cat > "$CORS_FILE" <<'JSON'
[{"origin": ["*"], "method": ["GET"], "responseHeader": ["Content-Type"], "maxAgeSeconds": 3600}]
JSON
gcloud storage buckets update "gs://$BUCKET" --cors-file="$CORS_FILE" --project "$PROJECT"
rm -f "$CORS_FILE"

echo "==> Grant the job's service account write access to the bucket"
SA="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:${SA}" --role=roles/storage.objectAdmin --project "$PROJECT"

echo "==> Deploy refresh job (Cloud Run Job)"
gcloud run jobs deploy "$JOB" \
  --source "$REPO_ROOT/pipeline" \
  --project "$PROJECT" --region "$REGION" \
  --set-env-vars "GCS_BUCKET=${BUCKET}" \
  --task-timeout 1800 --memory 1Gi

echo "==> Daily Cloud Scheduler trigger (03:00 UTC)"
gcloud scheduler jobs create http "${JOB}-daily" \
  --project "$PROJECT" --location "$REGION" \
  --schedule "0 3 * * *" \
  --uri "https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run" \
  --http-method POST \
  --oauth-service-account-email "$SA" 2>/dev/null \
  || echo "  (scheduler job already exists)"

echo "==> Run the job once to populate the dataset"
gcloud run jobs execute "$JOB" --project "$PROJECT" --region "$REGION" --wait || true

echo ""
echo "Done. Set the frontend's data source and redeploy Pages:"
echo "  .env.production -> VITE_DATA_URL=https://storage.googleapis.com/${BUCKET}/dataset.json"
