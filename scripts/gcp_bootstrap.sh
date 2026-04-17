#!/usr/bin/env bash
# Bootstrap a GCP project for GemmaPlay.
# Run once per project. Idempotent.
#
# Usage:
#   export PROJECT_ID=your-gcp-project
#   export REGION=us-central1
#   ./scripts/gcp_bootstrap.sh
#
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID=your-gcp-project}"
REGION="${REGION:-us-central1}"
BUCKET="${PROJECT_ID}-gemmaplay"
REPO="gemmaplay"

echo "==> Project: $PROJECT_ID  Region: $REGION"
gcloud config set project "$PROJECT_ID"

echo "==> Enabling required services"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com \
  aiplatform.googleapis.com

echo "==> Creating Artifact Registry repo (if missing)"
gcloud artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="GemmaPlay container images"

echo "==> Creating GCS bucket (if missing)"
gsutil ls -b "gs://$BUCKET" >/dev/null 2>&1 || \
  gsutil mb -l "$REGION" "gs://$BUCKET"

echo "==> Granting Cloud Run service account access to Vertex AI and the bucket"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SA}" \
  --role=roles/aiplatform.user \
  --condition=None >/dev/null

gsutil iam ch "serviceAccount:${SA}:objectAdmin" "gs://$BUCKET"

echo ""
echo "✓ Bootstrap complete."
echo ""
echo "Next steps:"
echo "  1. Authenticate locally for Vertex AI (Application Default Credentials):"
echo "       gcloud auth application-default login"
echo "  2. In backend/.env, set:"
echo "       GEMMA_PROVIDER=vertex"
echo "       GCP_PROJECT_ID=${PROJECT_ID}"
echo "       GCP_REGION=${REGION}"
echo "  3. Deploy:"
echo "       gcloud builds submit --config=infra/cloudbuild.yaml ."
