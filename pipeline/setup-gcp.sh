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

# The scraper repo (hamzaabamboo/ll-sorter-scripts) is PRIVATE, so the job needs
# a GitHub token with read access to clone it. Stored in Secret Manager.
: "${GITHUB_TOKEN:?Set GITHUB_TOKEN to a GitHub PAT with read access to the scraper repo}"
SECRET="${SECRET:-ll-github-token}"

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com \
  storage.googleapis.com secretmanager.googleapis.com --project "$PROJECT"

echo "==> Store GitHub token in Secret Manager ($SECRET)"
if ! gcloud secrets describe "$SECRET" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud secrets create "$SECRET" --project "$PROJECT" --replication-policy automatic
fi
printf '%s' "$GITHUB_TOKEN" | gcloud secrets versions add "$SECRET" --project "$PROJECT" --data-file=-

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

echo "==> Grant the job's service account access (bucket write + secret read)"
SA="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:${SA}" --role=roles/storage.objectAdmin --project "$PROJECT"
gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT" \
  --member="serviceAccount:${SA}" --role=roles/secretmanager.secretAccessor

echo "==> Deploy refresh job (Cloud Run Job)"
gcloud run jobs deploy "$JOB" \
  --source "$REPO_ROOT/pipeline" \
  --project "$PROJECT" --region "$REGION" \
  --set-env-vars "GCS_BUCKET=${BUCKET}" \
  --set-secrets "GITHUB_TOKEN=${SECRET}:latest" \
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
