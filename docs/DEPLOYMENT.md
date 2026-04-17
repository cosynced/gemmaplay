# GCP Deployment

Target architecture: Cloud Run (backend) + Firebase Hosting (frontend) + GCS (uploads) + Secret Manager (Gemma key).

## Prerequisites

- GCP project with billing enabled
- `gcloud` CLI authenticated (`gcloud auth login`)
- Google AI Studio API key in hand ([get one](https://aistudio.google.com/apikey))

## One-time setup

From the repo root:

```bash
export PROJECT_ID=your-gcp-project
export REGION=us-central1
./scripts/gcp_bootstrap.sh
```

This enables required APIs, creates an Artifact Registry repo, a GCS bucket, a Secret Manager entry, and grants the Cloud Run service account access to both.

Add your API key to the secret:

```bash
echo -n "YOUR_GEMMA_API_KEY" | gcloud secrets versions add gemma-api-key --data-file=-
```

## Deploy the backend

```bash
gcloud builds submit --config=infra/cloudbuild.yaml .
```

What this does:
1. Builds the backend Docker image
2. Pushes it to Artifact Registry
3. Deploys a new Cloud Run revision, wiring in env vars and the Gemma API key from Secret Manager

Cloud Build will print the service URL when done. Expect something like:
```
https://gemmaplay-api-abc123-uc.a.run.app
```

Verify:
```bash
curl https://gemmaplay-api-abc123-uc.a.run.app/readyz
```

## Deploy the frontend

Two easy options. Pick one.

### Option A: Firebase Hosting (recommended)

```bash
cd frontend
npm install -g firebase-tools
firebase login
firebase init hosting   # choose 'dist' as public, single-page app = yes, no GitHub Actions
echo "VITE_API_BASE=https://gemmaplay-api-abc123-uc.a.run.app" > .env.production
npm run build
firebase deploy --only hosting
```

### Option B: Cloud Run (static container)

Build a small nginx container that serves `dist/` and deploy it the same way as the backend. More overhead, but keeps everything in one platform. Firebase is faster for hackathon scope.

## CORS

The backend reads `CORS_ORIGINS` from env. Update in the Cloud Run service to your frontend URL:

```bash
gcloud run services update gemmaplay-api \
  --region=us-central1 \
  --set-env-vars=CORS_ORIGINS=https://your-site.web.app
```

## Cold starts

Cloud Run scales to zero by default. First request after idle takes 3-8 seconds to spin up. For the judges' demo:

- Hit `/healthz` right before the demo to warm the instance
- Or set `--min-instances=1` temporarily (costs ~$5/month idle)

```bash
gcloud run services update gemmaplay-api --region=us-central1 --min-instances=1
```

Remember to set it back to 0 after the hackathon.

## Logs

```bash
gcloud run services logs tail gemmaplay-api --region=us-central1
```

Structured logs (JSON) make this easy to filter. Everything is tagged with the agent name (`lesson_agent_start`, `adaptation_signal`, etc.) via structlog.

## Rolling back

Cloud Run keeps revisions. Roll back to the last known good:

```bash
gcloud run services update-traffic gemmaplay-api \
  --region=us-central1 \
  --to-revisions=gemmaplay-api-00005-abc=100
```

## Cost estimate (hackathon scope)

- Cloud Run: free tier covers it unless the demo goes viral
- Cloud Build: first 120 min/day free
- Artifact Registry: free under 0.5 GB
- GCS: negligible
- Secret Manager: negligible
- Gemma API: free tier, 1500 req/day

Net: expect $0-$3 total through the hackathon.

## Post-hackathon hardening

Not needed to ship, but worth noting:

- Move SQLite to Cloud SQL Postgres (`DATABASE_URL` swap)
- Add Firebase Auth for teacher accounts
- Move adaptation state to Redis/Memorystore if you run more than 1 Cloud Run instance
- Add Cloud Armor rate limiting
- Set up Cloud Monitoring alerts on `/readyz` failures
