#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "YTDownloader — local pipeline setup"
echo "──────────────────────────────────"

OS="$(uname -s)"

install_macos() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew not found. Install from https://brew.sh then re-run: npm run setup:local"
    exit 1
  fi
  echo "Installing yt-dlp and ffmpeg via Homebrew…"
  brew install yt-dlp ffmpeg
}

install_linux() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "Installing yt-dlp and ffmpeg via apt…"
    sudo apt-get update
    sudo apt-get install -y ffmpeg python3 python3-pip curl ca-certificates
    sudo curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" \
      -o /usr/local/bin/yt-dlp
    sudo chmod +x /usr/local/bin/yt-dlp
  else
    echo "Unsupported Linux package manager."
    echo "Install manually:"
    echo "  ffmpeg   — your distro package manager"
    echo "  yt-dlp   — https://github.com/yt-dlp/yt-dlp#installation"
    exit 1
  fi
}

case "$OS" in
  Darwin) install_macos ;;
  Linux)  install_linux ;;
  *)
    echo "Unsupported OS: $OS"
    echo "Install yt-dlp and ffmpeg manually, then run: npm run check:deps"
    exit 1
    ;;
esac

if [[ ! -f .env.local ]]; then
  cp .env.local.example .env.local
  echo "Created .env.local from .env.local.example — fill in your credentials."
fi

echo ""
bash scripts/check-deps.sh || true
echo ""
echo "Next steps:"
echo "  1. Edit .env.local with Supabase, R2, and YouTube API credentials"
echo "  2. Run Supabase migration: supabase/migrations/20240101_pipeline.sql"
echo "  3. Start app: npm run dev:pipeline"
