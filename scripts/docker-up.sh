#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env.local ]]; then
  echo "Missing .env.local — copy .env.local.example and fill in values first."
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
fi

echo "Building and starting YTDownloader in Docker…"
docker compose up --build -d

echo ""
echo "Waiting for health check…"
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${PORT:-3000}/api/health" >/dev/null 2>&1; then
    echo "✓ App is up at http://localhost:${PORT:-3000}"
    curl -s "http://localhost:${PORT:-3000}/api/health" | python3 -m json.tool 2>/dev/null || true
    exit 0
  fi
  sleep 2
done

echo "Container started but health check did not pass yet."
echo "Check logs: npm run docker:logs"
exit 1
