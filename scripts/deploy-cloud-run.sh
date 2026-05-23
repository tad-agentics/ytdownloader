#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PROJECT_ID="${GCP_PROJECT_ID:-ytdownloader-497208}"
REGION="${GCP_REGION:-asia-southeast1}"
SERVICE="${CLOUD_RUN_SERVICE:-ytdownloader}"
ENV_FILE="${ENV_FILE:-.env.local}"
ENV_YAML=".env.cloudrun.yaml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE - copy .env.local.example and fill in credentials."
  exit 1
fi

echo "Generating Cloud Run env file from ${ENV_FILE}..."
python3 - "$ENV_FILE" "$ENV_YAML" <<'PY'
import sys
from pathlib import Path

src, dst = sys.argv[1], sys.argv[2]
allowed = {
    "YOUTUBE_API_KEY_1", "YOUTUBE_API_KEY_2", "YOUTUBE_API_KEY_3",
    "CLOUDFLARE_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME", "R2_PUBLIC_DOMAIN", "SUBTITLE_LANGS",
    "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
}
lines = []
for raw in Path(src).read_text().splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    key, value = key.strip(), value.strip()
    if key in allowed and value:
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'{key}: "{escaped}"')
Path(dst).write_text("\n".join(lines) + "\n")
print(f"Wrote {len(lines)} vars to {dst}")
PY

echo "Setting gcloud project -> ${PROJECT_ID}"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "Enabling required APIs (idempotent)…"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --project="$PROJECT_ID"

echo "Deploying $SERVICE to Cloud Run ($REGION)…"
gcloud run deploy "$SERVICE" \
  --source . \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --platform=managed \
  --memory=4Gi \
  --cpu=2 \
  --timeout=3600 \
  --concurrency=1 \
  --min-instances=0 \
  --max-instances=3 \
  --allow-unauthenticated \
  --quiet \
  --env-vars-file="$ENV_YAML"

URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
echo ""
echo "Deployed: $URL"
echo "Health:   $URL/api/health"
echo ""
echo "Waiting for health check…"
for i in $(seq 1 30); do
  if curl -sf "$URL/api/health" >/dev/null 2>&1; then
    curl -s "$URL/api/health" | python3 -m json.tool
    exit 0
  fi
  sleep 5
done
echo "Service deployed but health check did not pass yet - try: curl ${URL}/api/health"
