# YTDownloader

Full-stack YouTube pipeline operator: keywords → YouTube search → MP4 download via yt-dlp → Cloudflare R2.

## Stack

- **Next.js 14** (App Router) — dashboard UI + API routes + pipeline worker
- **Supabase** — job and video state
- **Cloudflare R2** — MP4 storage
- **YouTube Data API v3** — search and metadata
- **yt-dlp + ffmpeg** — download (required for pipeline; bundled in Docker)

## Prerequisites

1. Run the Supabase migration: `supabase/migrations/20240101_pipeline.sql`
2. Copy env file and fill credentials:

```bash
cp .env.local.example .env.local
```

Required vars: `YOUTUBE_API_KEY_1`, `CLOUDFLARE_ACCOUNT_ID`, `R2_*`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

---

## Option A — Full pipeline via Docker (recommended)

Docker includes **yt-dlp**, **ffmpeg**, and the production Next.js build. No local binary install needed.

```bash
npm run docker:up
```

Open [http://localhost:3000](http://localhost:3000). Verify health:

```bash
curl http://localhost:3000/api/health
```

All three checks (`ytdlp`, `r2`, `youtubeApi`) should report `"ok": true` once `.env.local` is configured.

Other commands:

```bash
npm run docker:build   # build image only
npm run docker:logs    # follow container logs
npm run docker:down    # stop container
```

---

## Option B — Full pipeline locally (yt-dlp + ffmpeg on host)

Install system binaries, then run Next.js dev server:

```bash
npm run setup:local    # macOS: brew install yt-dlp ffmpeg
npm run check:deps     # verify binaries + .env.local
npm run dev:pipeline   # check deps, then next dev
```

On macOS manually:

```bash
brew install yt-dlp ffmpeg
```

On Linux (Debian/Ubuntu):

```bash
sudo apt-get install -y ffmpeg python3 curl
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod +x /usr/local/bin/yt-dlp
```

Production-style local run (after `npm run build`):

```bash
npm run start:pipeline
```

---

## UI-only dev (no pipeline)

Dashboard loads but downloads will fail without yt-dlp:

```bash
npm install
npm run dev
```

---

## API

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/health` | yt-dlp, R2, YouTube API checks |
| POST | `/api/pipeline/scrape` | Start jobs `{ keywords, maxResults, quality }` |
| GET | `/api/pipeline/jobs?summary=1&r2=1` | List jobs + storage summary |
| GET/PATCH | `/api/pipeline/jobs/[id]` | Job detail / stop signal |

## Docs

- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) — architecture, checklist, Cloud Run deploy
- [artifacts/AUDIT.md](artifacts/AUDIT.md) — spec alignment audit
