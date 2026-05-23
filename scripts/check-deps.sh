#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok=0
fail=0
warn=0

pass() { echo -e "${GREEN}✓${NC} $1"; ok=$((ok + 1)); }
err()  { echo -e "${RED}✗${NC} $1"; fail=$((fail + 1)); }
note() { echo -e "${YELLOW}!${NC} $1"; warn=$((warn + 1)); }

echo "YTDownloader — dependency check"
echo "──────────────────────────────"

if command -v yt-dlp >/dev/null 2>&1; then
  pass "yt-dlp $(yt-dlp --version 2>/dev/null | head -1)"
else
  err "yt-dlp not found — run: npm run setup:local"
fi

if command -v ffmpeg >/dev/null 2>&1; then
  pass "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f3)"
else
  err "ffmpeg not found — run: npm run setup:local"
fi

if [[ -f .env.local ]]; then
  pass ".env.local exists"
  required=(
    YOUTUBE_API_KEY_1
    CLOUDFLARE_ACCOUNT_ID
    R2_ACCESS_KEY_ID
    R2_SECRET_ACCESS_KEY
    R2_BUCKET_NAME
    NEXT_PUBLIC_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
  )
  for key in "${required[@]}"; do
    if grep -q "^${key}=" .env.local && ! grep -q "^${key}=$" .env.local && ! grep -q "^${key}=\\.\\.\\." .env.local; then
      pass "  ${key} set"
    else
      note "  ${key} missing or placeholder — fill in .env.local"
    fi
  done
else
  err ".env.local missing — copy .env.local.example and fill in values"
fi

echo "──────────────────────────────"
if [[ $fail -gt 0 ]]; then
  echo -e "${RED}${fail} required check(s) failed${NC}"
  exit 1
fi

if [[ $warn -gt 0 ]]; then
  echo -e "${YELLOW}${warn} warning(s) — pipeline may fail at runtime${NC}"
fi

echo -e "${GREEN}Ready for local pipeline (npm run dev:pipeline)${NC}"
