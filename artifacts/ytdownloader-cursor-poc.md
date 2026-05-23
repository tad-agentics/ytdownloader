# YTDownloader — Cursor Implementation Guide

> **Scope**: Full-stack pipeline operator. Keywords → YouTube search → MP4 download via yt-dlp → Cloudflare R2. Single-page dashboard with inline pipeline flow and stop/abort support.
> **Stack**: Next.js 14 (App Router) · Supabase · Cloudflare R2 · Cloud Run (worker) · YouTube Data API v3
> **Timeline**: 4 phases, ~12–16h total implementation

---

## Architecture Overview

```
[Next.js App — Cloud Run]  ← ONE deployment: dashboard UI + API routes + pipeline worker
        │
        ├─ GET   /api/pipeline/jobs          → Supabase (poll every 3s while active)
        ├─ POST  /api/pipeline/scrape        → runPipelineJob() fire-and-forget (same process)
        └─ PATCH /api/pipeline/jobs/[id]     → Supabase (stop signal)
        │
        ├─ YouTube Data API v3   (search + metadata, 100 units/search)
        ├─ yt-dlp subprocess     (download MP4 to /tmp, sequential + jitter)
        └─ Cloudflare R2         (multipart upload, 10MB parts)

[Supabase]   ← job + video state, read by dashboard poll
[R2 Bucket]  ← final MP4 storage
```

**Why everything runs on Cloud Run, not Vercel:**
- yt-dlp is a system binary — cannot install in Vercel serverless
- MP4 files are 50MB–1GB; Vercel body limit is 4.5MB, timeout max 300s
- Cloud Run: 3,600s timeout, 32GB RAM, custom Docker container with ffmpeg + yt-dlp
- The `POST /api/pipeline/scrape` route calls `runPipelineJob()` fire-and-forget **within the same process** — no separate worker service needed for the PoC

**Stop mechanism:** dashboard sends `PATCH /api/pipeline/jobs/[id]` with `{ status: "stopping" }`. Orchestrator checks job status from Supabase before processing each video. On detection: resets in-progress video to `queued`, sets job to `stopped`. No special infra needed.

---

## File Structure

```
ytdownloader/
├── app/
│   ├── page.tsx                             ← Single-page pipeline dashboard
│   ├── layout.tsx
│   └── api/
│       ├── pipeline/
│       │   ├── scrape/route.ts              ← POST: trigger job(s) by keyword array
│       │   ├── jobs/route.ts                ← GET: list all jobs + storage summary
│       │   └── jobs/[id]/route.ts           ← PATCH: stop signal | GET: job detail
│       └── health/route.ts                  ← GET: yt-dlp + R2 + YT API ping
├── lib/
│   └── pipeline/
│       ├── youtube-search.ts                ← YouTube Data API v3 (search + details)
│       ├── downloader.ts                    ← yt-dlp subprocess wrapper
│       ├── r2.ts                            ← Cloudflare R2 upload (S3 SDK)
│       ├── job-store.ts                     ← Supabase read/write
│       └── orchestrator.ts                  ← search → download → upload + stop check
├── components/
│   ├── pipeline/
│   │   ├── StepStrip.tsx                    ← ① Keywords › ② Search › ③ Download & Upload
│   │   ├── KeywordInput.tsx                 ← tag input + config row + Run/Stop buttons
│   │   ├── VideoGrid.tsx                    ← video cards with per-card progress bars
│   │   └── ProgressSummary.tsx              ← overall bar: N% · done/total · status message
│   └── storage/
│       ├── StorageOverview.tsx              ← total stored GB + R2 available side-by-side
│       ├── StatCards.tsx                    ← 3 cards: Downloaded / Failed / Success%
│       └── AllocationBars.tsx              ← keyword distribution bars
├── supabase/
│   └── migrations/
│       └── 20240101_pipeline.sql
├── Dockerfile
├── .env.local.example
└── package.json
```

---

## Phase 1 — Database + Environment (2h)

### 1.1 Supabase migration

**File**: `supabase/migrations/20240101_pipeline.sql`

```sql
CREATE TABLE pipeline_jobs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword           TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'queued'
                                CHECK (status IN (
                                  'queued','searching','downloading',
                                  'uploading','stopping','stopped','done','failed'
                                )),
  max_results       INT         NOT NULL DEFAULT 10,
  quality           TEXT        NOT NULL DEFAULT '720p',
  region_code       TEXT        NOT NULL DEFAULT 'VN',
  videos_found      INT         NOT NULL DEFAULT 0,
  videos_downloaded INT         NOT NULL DEFAULT 0,
  videos_failed     INT         NOT NULL DEFAULT 0,
  total_size_bytes  BIGINT      NOT NULL DEFAULT 0,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE TABLE pipeline_videos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID        NOT NULL REFERENCES pipeline_jobs(id) ON DELETE CASCADE,
  video_id         TEXT        NOT NULL,
  keyword          TEXT        NOT NULL,
  title            TEXT,
  channel          TEXT,
  view_count       BIGINT      NOT NULL DEFAULT 0,
  duration_seconds INT         NOT NULL DEFAULT 0,
  r2_key           TEXT,
  r2_public_url    TEXT,
  file_size_bytes  BIGINT      NOT NULL DEFAULT 0,
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','downloading','uploading','stored','failed','queued')),
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_jobs_status     ON pipeline_jobs(status);
CREATE INDEX idx_jobs_keyword    ON pipeline_jobs(keyword);
CREATE INDEX idx_jobs_created    ON pipeline_jobs(created_at DESC);
CREATE INDEX idx_videos_job      ON pipeline_videos(job_id);
CREATE INDEX idx_videos_keyword  ON pipeline_videos(keyword);
CREATE UNIQUE INDEX idx_videos_unique ON pipeline_videos(job_id, video_id);

-- Auto-update trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON pipeline_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Summary view (used by dashboard storage panel)
CREATE VIEW pipeline_summary AS
SELECT
  COUNT(*)                                                       AS total_jobs,
  COUNT(*) FILTER (WHERE status = 'done')                       AS done_jobs,
  COUNT(*) FILTER (WHERE status IN ('stopped','failed'))        AS stopped_jobs,
  COUNT(*) FILTER (WHERE status NOT IN ('done','stopped','failed')) AS active_jobs,
  COALESCE(SUM(videos_downloaded), 0)                           AS total_videos,
  COALESCE(SUM(total_size_bytes),  0)                           AS total_bytes
FROM pipeline_jobs;

-- Video counts per status (useful for dashboard stats panel)
CREATE VIEW pipeline_video_summary AS
SELECT
  keyword,
  COUNT(*) FILTER (WHERE status = 'stored')  AS stored_count,
  COUNT(*) FILTER (WHERE status = 'failed')  AS failed_count,
  COUNT(*) FILTER (WHERE status = 'queued')  AS queued_count,
  COALESCE(SUM(file_size_bytes) FILTER (WHERE status = 'stored'), 0) AS stored_bytes
FROM pipeline_videos
GROUP BY keyword;
```

### 1.2 Environment variables

**File**: `.env.local`

```bash
# YouTube Data API v3
# console.cloud.google.com → New Project → Enable "YouTube Data API v3" → Credentials → API Key
# Free: 10,000 units/day = 100 searches/day. Add _2, _3 for key rotation across GCP projects.
YOUTUBE_API_KEY_1=AIzaSy...
YOUTUBE_API_KEY_2=AIzaSy...   # optional second GCP project

# Cloudflare R2
# Dashboard → R2 → Manage R2 API Tokens → Object Read & Write
CLOUDFLARE_ACCOUNT_ID=abc123...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=yt-downloader-corpus
R2_PUBLIC_DOMAIN=pub.yourdomain.com   # optional — only if bucket has public access enabled

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### 1.3 npm install

```bash
npm install @aws-sdk/client-s3 @aws-sdk/lib-storage uuid @supabase/supabase-js
npm install -D @types/uuid
```

> No `recharts` — the dashboard has no chart. All pipeline state is shown inline on video cards.

---

## Phase 2 — Backend Pipeline (4h)

### 2.1 YouTube search

**File**: `lib/pipeline/youtube-search.ts`

```typescript
const BASE = "https://www.googleapis.com/youtube/v3";

function getApiKey(): string {
  const keys = [
    process.env.YOUTUBE_API_KEY_1,
    process.env.YOUTUBE_API_KEY_2,
    process.env.YOUTUBE_API_KEY_3,
  ].filter(Boolean) as string[];
  if (keys.length > 0)
    return keys[Math.floor(Date.now() / 86_400_000) % keys.length];
  const single = process.env.YOUTUBE_API_KEY;
  if (!single) throw new Error("No YOUTUBE_API_KEY set");
  return single;
}

function parseDuration(iso: string): number {
  const m = (iso || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + +(m[3] || 0);
}

export interface YouTubeVideo {
  videoId: string; title: string; url: string;
  channelName: string; publishedAt: string;
  thumbnailUrl: string; viewCount: number;
  duration: string; durationSeconds: number;
}

export async function searchYouTubeVideos(
  keyword: string,
  options: {
    maxResults?: number;
    regionCode?: string;
    relevanceLanguage?: string;
    order?: "relevance" | "viewCount" | "date";
    videoDuration?: "any" | "short" | "medium" | "long";
  } = {}
): Promise<YouTubeVideo[]> {
  const { maxResults = 10, regionCode = "VN", relevanceLanguage = "vi",
    order = "relevance", videoDuration = "any" } = options;
  const key = getApiKey();

  // Step 1: search.list — 100 quota units
  const sp = new URLSearchParams({ key, q: keyword, part: "snippet",
    type: "video", maxResults: String(Math.min(maxResults, 50)),
    regionCode, relevanceLanguage, order, videoDuration, videoEmbeddable: "true" });
  const sr = await fetch(`${BASE}/search?${sp}`);
  if (!sr.ok) { const e = await sr.json(); throw new Error(e.error?.message); }
  const items: any[] = (await sr.json()).items || [];
  if (!items.length) return [];

  // Step 2: videos.list — 1 quota unit × N videos
  const ids = items.map((i: any) => i.id?.videoId).filter(Boolean).join(",");
  const dr = await fetch(`${BASE}/videos?${new URLSearchParams({ key, id: ids, part: "snippet,statistics,contentDetails" })}`);
  const dm: Record<string, any> = {};
  for (const v of (await dr.json()).items || []) dm[v.id] = v;

  return items.map((item: any): YouTubeVideo | null => {
    const vid = item.id?.videoId;
    if (!vid) return null;
    const d = dm[vid] || {};
    const iso = d.contentDetails?.duration || "";
    return {
      videoId: vid,
      title: item.snippet.title,
      url: `https://www.youtube.com/watch?v=${vid}`,
      channelName: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      thumbnailUrl: item.snippet.thumbnails?.high?.url || "",
      viewCount: parseInt(d.statistics?.viewCount || "0", 10),
      duration: iso,
      durationSeconds: parseDuration(iso),
    };
  }).filter((v): v is YouTubeVideo => v !== null);
}
```

### 2.2 Downloader

**File**: `lib/pipeline/downloader.ts`

```typescript
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export type VideoQuality = "360p" | "480p" | "720p" | "1080p";

const FORMAT: Record<VideoQuality, string> = {
  "360p":  "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360]",
  "480p":  "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]",
  "720p":  "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]",
  "1080p": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080]",
};

export interface DownloadResult {
  filePath: string; fileName: string;
  fileSizeBytes: number; fileSizeMB: number;
}

export function downloadYouTubeVideo(
  url: string, videoId: string,
  quality: VideoQuality = "720p",
  timeoutMs = 5 * 60 * 1000
): Promise<DownloadResult> {
  const template = path.join(os.tmpdir(), `yt_${videoId}_${Date.now()}.%(ext)s`);
  const args = [
    "--format", FORMAT[quality], "--merge-output-format", "mp4",
    "--output", template, "--no-playlist", "--no-warnings", "--quiet", "--no-part",
    "--retries", "3", "--fragment-retries", "3", "--concurrent-fragments", "4",
    "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    url,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args);
    let stderr = "";
    proc.stderr?.on("data", d => { stderr += d.toString(); });
    const timer = setTimeout(() => { proc.kill("SIGTERM"); reject(new Error(`yt-dlp timeout for ${videoId}`)); }, timeoutMs);
    proc.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`yt-dlp exit ${code}: ${stderr.slice(0, 300)}`));
      const mp4 = template.replace("%(ext)s", "mp4");
      const mkv = template.replace("%(ext)s", "mkv");
      const p = fs.existsSync(mp4) ? mp4 : fs.existsSync(mkv) ? mkv : null;
      if (!p) return reject(new Error(`Output not found for ${videoId}`));
      const stats = fs.statSync(p);
      resolve({ filePath: p, fileName: path.basename(p),
        fileSizeBytes: stats.size, fileSizeMB: Math.round(stats.size / 1024 / 1024 * 10) / 10 });
    });
    proc.on("error", err => { clearTimeout(timer); reject(err); });
  });
}

export function cleanupTempFile(p: string) {
  try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
}
```

### 2.3 R2 upload

**File**: `lib/pipeline/r2.ts`

```typescript
import { S3Client, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "fs";

let _client: S3Client | null = null;
const client = () => {
  if (!_client) _client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
  return _client;
};
const BUCKET = () => process.env.R2_BUCKET_NAME || "yt-downloader-corpus";

export async function uploadToR2(
  filePath: string, keyword: string, videoId: string,
  metadata: Record<string, string> = {}
): Promise<{ r2Key: string; publicUrl: string; fileSizeBytes: number }> {
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const r2Key = `${slug}/${videoId}_${Date.now()}.mp4`;
  const fileSizeBytes = fs.statSync(filePath).size;

  await new Upload({
    client: client(),
    params: {
      Bucket: BUCKET(), Key: r2Key,
      Body: fs.createReadStream(filePath),
      ContentType: "video/mp4", ContentLength: fileSizeBytes,
      Metadata: { keyword, videoId, pipeline: "ytdownloader-v1",
        uploadedAt: new Date().toISOString(), ...metadata },
    },
    queueSize: 4, partSize: 10 * 1024 * 1024,
  }).done();

  const domain = process.env.R2_PUBLIC_DOMAIN;
  return {
    r2Key,
    publicUrl: domain ? `https://${domain}/${r2Key}` : `r2://${BUCKET()}/${r2Key}`,
    fileSizeBytes,
  };
}

export async function pingR2() {
  try { await client().send(new HeadBucketCommand({ Bucket: BUCKET() })); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e.message }; }
}

export async function listR2Objects(prefix?: string, maxKeys = 50) {
  const r = await client().send(new ListObjectsV2Command({ Bucket: BUCKET(), Prefix: prefix, MaxKeys: maxKeys }));
  return (r.Contents || []).map(o => ({ key: o.Key || "", sizeBytes: o.Size || 0, lastModified: o.LastModified }));
}
```

### 2.4 Job store

**File**: `lib/pipeline/job-store.ts`

```typescript
import { createClient } from "@supabase/supabase-js";

const db = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type JobStatus =
  "queued" | "searching" | "downloading" | "uploading" |
  "stopping" | "stopped" | "done" | "failed";

export async function createJob(id: string, keyword: string, maxResults: number, quality: string, regionCode: string) {
  const { error } = await db().from("pipeline_jobs")
    .insert({ id, keyword, status: "queued", max_results: maxResults, quality, region_code: regionCode });
  if (error) throw new Error(`createJob: ${error.message}`);
}

export async function updateJob(id: string, patch: Record<string, any>) {
  const { error } = await db().from("pipeline_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`updateJob: ${error.message}`);
}

export async function getJob(id: string) {
  const { data, error } = await db().from("pipeline_jobs").select("*").eq("id", id).single();
  if (error) return null;
  return data;
}

export async function listJobs(limit = 100) {
  const { data, error } = await db().from("pipeline_jobs")
    .select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`listJobs: ${error.message}`);
  return data;
}

export async function recordVideo(video: {
  job_id: string; video_id: string; keyword: string;
  title: string; channel: string; view_count: number; duration_seconds: number;
  r2_key: string | null; r2_public_url: string | null;
  file_size_bytes: number; status: "stored" | "failed" | "queued" | "pending"; error: string | null;
}) {
  const { error } = await db().from("pipeline_videos").insert(video);
  if (error) throw new Error(`recordVideo: ${error.message}`);
}

export async function listVideosByJob(jobId: string) {
  const { data, error } = await db().from("pipeline_videos")
    .select("*").eq("job_id", jobId).order("created_at", { ascending: true });
  if (error) throw new Error(`listVideosByJob: ${error.message}`);
  return data;
}

export async function getDashboardSummary() {
  const { data, error } = await db().from("pipeline_summary").select("*").single();
  if (error) throw new Error(`getDashboardSummary: ${error.message}`);
  return data;
}
```

### 2.5 Orchestrator with stop support

**File**: `lib/pipeline/orchestrator.ts`

```typescript
import { searchYouTubeVideos } from "./youtube-search";
import { downloadYouTubeVideo, cleanupTempFile, type VideoQuality } from "./downloader";
import { uploadToR2 } from "./r2";
import { createJob, updateJob, getJob, recordVideo } from "./job-store";

const jitter = (lo: number, hi: number) =>
  new Promise(r => setTimeout(r, lo + Math.random() * (hi - lo)));

// Check if a stop signal has been sent via PATCH /api/pipeline/jobs/[id]
async function shouldStop(jobId: string): Promise<boolean> {
  const job = await getJob(jobId);
  return job?.status === "stopping";
}

export async function runPipelineJob(
  jobId: string, keyword: string,
  opts: { maxResults?: number; quality?: VideoQuality; regionCode?: string } = {}
): Promise<void> {
  const { maxResults = 10, quality = "720p", regionCode = "VN" } = opts;
  await createJob(jobId, keyword, maxResults, quality, regionCode);

  try {
    // ── Phase 1: Search ─────────────────────────────────────────────────────────
    await updateJob(jobId, { status: "searching" });
    const videos = await searchYouTubeVideos(keyword, { maxResults, regionCode });
    await updateJob(jobId, { status: "downloading", videos_found: videos.length });

    if (!videos.length) {
      await updateJob(jobId, { status: "done", completed_at: new Date().toISOString() });
      return;
    }

    let downloaded = 0, failed = 0, totalBytes = 0;

    // ── Phase 2: Download + Upload ───────────────────────────────────────────────
    for (const video of videos) {
      // Stop check — Supabase polled before each video
      if (await shouldStop(jobId)) {
        await updateJob(jobId, { status: "stopped", completed_at: new Date().toISOString() });
        return;
      }

      let tmpPath: string | null = null;
      try {
        const dl = await downloadYouTubeVideo(video.url, video.videoId, quality as VideoQuality);
        tmpPath = dl.filePath;

        await updateJob(jobId, { status: "uploading" });
        const r2 = await uploadToR2(dl.filePath, keyword, video.videoId, {
          title: video.title.slice(0, 250),
          channel: video.channelName,
          viewCount: String(video.viewCount),
          durationSeconds: String(video.durationSeconds),
        });

        await recordVideo({
          job_id: jobId, video_id: video.videoId, keyword,
          title: video.title, channel: video.channelName,
          view_count: video.viewCount, duration_seconds: video.durationSeconds,
          r2_key: r2.r2Key, r2_public_url: r2.publicUrl,
          file_size_bytes: r2.fileSizeBytes, status: "stored", error: null,
        });

        downloaded++;
        totalBytes += r2.fileSizeBytes;
        await updateJob(jobId, { status: "downloading", videos_downloaded: downloaded, total_size_bytes: totalBytes });

      } catch (err: any) {
        failed++;
        await recordVideo({
          job_id: jobId, video_id: video.videoId, keyword,
          title: video.title, channel: video.channelName,
          view_count: video.viewCount, duration_seconds: video.durationSeconds,
          r2_key: null, r2_public_url: null, file_size_bytes: 0,
          status: "failed", error: err.message?.slice(0, 500),
        });
        await updateJob(jobId, { videos_failed: failed });
      } finally {
        if (tmpPath) cleanupTempFile(tmpPath);
        await jitter(2000, 5000); // 2–5s anti-bot jitter between downloads
      }
    }

    await updateJob(jobId, {
      status: "done", videos_downloaded: downloaded,
      videos_failed: failed, total_size_bytes: totalBytes,
      completed_at: new Date().toISOString(),
    });

  } catch (err: any) {
    await updateJob(jobId, { status: "failed", error: err.message?.slice(0, 1000) });
    throw err;
  }
}
```

### 2.6 API routes

**File**: `app/api/pipeline/scrape/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { runPipelineJob } from "@/lib/pipeline/orchestrator";

// Hard cap: 30 videos × ~90s/video = ~2,700s, safely within Cloud Run's 3,600s timeout.
// Increase only if you raise --timeout in the Cloud Run deploy command.
const MAX_VIDEOS_PER_JOB = 30;

export async function POST(req: NextRequest) {
  const { keywords, maxResults = 10, quality = "720p", regionCode = "VN" } = await req.json();
  if (!Array.isArray(keywords) || !keywords.length)
    return NextResponse.json({ error: "keywords[] required" }, { status: 400 });

  const cappedMax = Math.min(parseInt(String(maxResults), 10) || 10, MAX_VIDEOS_PER_JOB);

  const jobs = keywords
    .map((kw: string) => ({ jobId: uuidv4(), keyword: kw.trim() }))
    .filter(j => j.keyword.length > 0);

  for (const { jobId, keyword } of jobs) {
    runPipelineJob(jobId, keyword, {
      maxResults: cappedMax, quality, regionCode,
    }).catch(err => console.error(`Job ${jobId} failed:`, err));
  }

  return NextResponse.json({ success: true, jobs });
}
```

**File**: `app/api/pipeline/jobs/[id]/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getJob, updateJob, listVideosByJob } from "@/lib/pipeline/job-store";

// GET — job detail + its videos
export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const [job, videos] = await Promise.all([
    getJob(params.id),
    listVideosByJob(params.id),
  ]);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ job, videos });
}

// PATCH — stop signal: sets status to "stopping"; orchestrator detects on next poll
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { status } = await req.json();
  if (status !== "stopping")
    return NextResponse.json({ error: "Only status=stopping is supported" }, { status: 400 });

  const job = await getJob(params.id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!["searching","downloading","uploading"].includes(job.status))
    return NextResponse.json({ error: `Cannot stop job in status: ${job.status}` }, { status: 409 });

  await updateJob(params.id, { status: "stopping" });
  return NextResponse.json({ success: true, jobId: params.id, status: "stopping" });
}
```

**File**: `app/api/pipeline/jobs/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { listJobs, getDashboardSummary } from "@/lib/pipeline/job-store";
import { pingR2 } from "@/lib/pipeline/r2";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const [jobs, summary, r2] = await Promise.all([
    listJobs(100),
    searchParams.get("summary") === "1" ? getDashboardSummary() : Promise.resolve(null),
    searchParams.get("r2")      === "1" ? pingR2()              : Promise.resolve(null),
  ]);
  return NextResponse.json({ jobs, summary, r2 });
}
```

**File**: `app/api/health/route.ts`

```typescript
import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { pingR2 } from "@/lib/pipeline/r2";

export async function GET() {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // yt-dlp binary
  try {
    const ver = execSync("yt-dlp --version", { timeout: 5000 }).toString().trim();
    checks.ytdlp = { ok: true, detail: ver };
  } catch (e: any) {
    checks.ytdlp = { ok: false, detail: e.message };
  }

  // Cloudflare R2
  const r2 = await pingR2();
  checks.r2 = r2;

  // YouTube API v3 — ping a known video (no quota cost for a cached single-video fetch)
  try {
    const key = process.env.YOUTUBE_API_KEY_1 || process.env.YOUTUBE_API_KEY;
    if (!key) throw new Error("No API key set");
    const r = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=dQw4w9WgXcQ&key=${key}`
    );
    checks.youtubeApi = { ok: r.ok, detail: `HTTP ${r.status}` };
  } catch (e: any) {
    checks.youtubeApi = { ok: false, detail: e.message };
  }

  const allOk = Object.values(checks).every(c => c.ok);
  return NextResponse.json({ ok: allOk, checks }, { status: allOk ? 200 : 503 });
}
```

**File**: `next.config.js`

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",   // required for Dockerfile COPY .next/standalone
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },     // YouTube thumbnails
      { protocol: "https", hostname: "img.youtube.com" },
    ],
  },
};

module.exports = nextConfig;
```

**File**: `app/layout.tsx`

```typescript
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YTDownloader",
  description: "YouTube → R2 pipeline operator",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

---

## Phase 3 — Dashboard UI (4h)

### Layout

Single page, no tabs, no navigation. One white card (`border-radius: 16px`) on a gray background (`#e8e9eb`). Two columns separated by a 1px divider.

```
[DARK HEADER #111 — height 52px]
  [Logo] YTDownloader          [YT API · active] [R2 · connected] [VN · 720p]

[GRAY BG #e8e9eb — padding 20px]
  [WHITE CARD — max-width 1180px, padding 30px]

  [LEFT ~60%]                              [1px divider]  [RIGHT 304px]
  ─────────────────────────────────────                   ──────────────────
  "Pipeline"                                              "Storage"
                                                          ─────────────────
  ① Keywords › ② Search › ③ Download & Upload            Total stored  R2 avail
  (step indicator — ticks green when phase complete)       47.2 GB      52.8 GB
                                                            247 files    of 100 GB
  [keyword input + tag pills]
  [N videos / keyword ▼] [720p ▼]  [Run Pipeline ▶] [■ Stop]   [Downloaded] [Failed] [Success%]
                                                               Gray card    Dark card  Teal card
  — searching state: spinner + "Searching YouTube…" —
                                                            "Keyword distribution"
  [VIDEO GRID — auto-fill 170px min columns]               Stored ■  Pending ·
  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
  │ thumb  │ │ thumb  │ │↓DL     │ │ ✓      │            [SA] shopee affiliate ████░░ 68%
  │        │ │        │ │        │ │        │            [TC] tiktok creator   ███░░░ 55%
  ├────────┤ ├────────┤ ├▓▓▓▓▓░░─┤ ├────────┤            [HF] hook formula    ███░░░ 43%
  │ title  │ │ title  │ │ title  │ │ title  │            [VV] viral vietnam   ██░░░░ 28%
  │ views  │ │ views  │ │ views  │ │ views  │
  └────────┘ └────────┘ └────────┘ └────────┘

  [47% ──────────────────────── 6/13 complete]
  — stopped state: bar turns amber, label = "Stopped — N stored, M remaining" —
```

### Component spec

**`StepStrip.tsx`**
- Props: `phase: "input"|"searching"|"results"|"processing"|"stopped"|"done"`
- 3 steps: ① Keywords, ② Search, ③ Download & Upload
- Step number circle: ticks green (✓) when that phase is complete
- Active step: `color: #111`. Inactive: `color: #aaa`. Done: `color: #1a5c60`

**`KeywordInput.tsx`**
- Tag-based keyword input: type + Enter or click Add; backspace removes last tag
- Deduplication: `keywords.includes(k)` guard before adding
- Config row: `<select>` for videos/keyword (5/8/10/20/50), quality (360p–1080p)
- Run button: state-aware label — "Run Pipeline" → "Searching…" → "Processing (N active)" → "Run again"
- Stop button: appears only while `isRunning`, red border, calls `PATCH /api/pipeline/jobs/[id]`
- Both inputs disabled while `isRunning`

**`VideoGrid.tsx`**
- `display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 9px`
- Each card state drives border colour:
  - `queued` → `#e2e2e2`
  - `downloading` → `#f59e0b`
  - `uploading` → `#a78bfa`
  - `done` → `#7fd4d8`
  - `failed` → `#fca5a5`
- Per-card progress bar: 2px strip below thumbnail; amber for DL, purple for upload, teal for done
- Status badge (absolute, top-right of thumbnail): `↓ DL` / `↑ R2` / `✓` / `✗`
- Card info: title (2-line clamp), views + MB

**`ProgressSummary.tsx`**
- Shown when `phase === "processing" || done || stopped`
- Overall bar: teal normally, amber when `stopped`
- Label: `N% · done/total complete` or `Done — N stored, X MB to R2` or `Stopped — N stored, M remaining`

**`StorageOverview.tsx`**
- Two side-by-side columns: Total stored (GB + file count) and R2 Available
- Both update live from `GET /api/pipeline/jobs?summary=1&r2=1`

**`StatCards.tsx`**
- 3 cards in a CSS 3-column grid:
  - Gray `#d4d5d8`: Downloaded (count)
  - Black `#111`: Failed (count)
  - Teal `#7fd4d8`: Success % (`Math.round(done/total*100)`, shows `—` when no jobs)

**`AllocationBars.tsx`**
- Each row: `[initials circle 19px] [keyword name 76px] [bar: teal fill + dotted remainder] [pct]`
- Bar fill width: `(stored / maxStored) * 62%` — proportional, not absolute
- Legend: Stored ■ (teal dot), Pending · (gray dot with border)

### Fonts + design tokens

```typescript
// lib/design-tokens.ts
export const tokens = {
  font: { sans: "'DM Sans', sans-serif", mono: "'DM Mono', monospace" },
  color: {
    bg:         "#e8e9eb",  // page background
    card:       "#ffffff",  // main white card
    header:     "#111111",  // top nav bar
    teal:       "#7fd4d8",  // primary accent (done state, bars, teal card)
    tealLight:  "#c4eaec",  // Pause button background
    tealDark:   "#1a5c60",  // text on teal backgrounds
    cardGray:   "#d4d5d8",  // first stat card
    cardBlack:  "#111111",  // second stat card
    border:     "#e2e2e2",  // dividers + card borders
    amber:      "#f59e0b",  // downloading progress, stopped bar
    purple:     "#a78bfa",  // uploading progress
    muted:      "#888888",  // secondary text
    hint:       "#aaaaaa",  // tertiary text
  },
};
```

### State management in `app/page.tsx`

```typescript
"use client";
import { useState, useRef, useEffect } from "react";
import StepStrip from "@/components/pipeline/StepStrip";
import KeywordInput from "@/components/pipeline/KeywordInput";
import VideoGrid from "@/components/pipeline/VideoGrid";
import ProgressSummary from "@/components/pipeline/ProgressSummary";
import StorageOverview from "@/components/storage/StorageOverview";
import StatCards from "@/components/storage/StatCards";
import AllocationBars from "@/components/storage/AllocationBars";

type Phase = "input"|"searching"|"results"|"processing"|"stopped"|"done";

// Video as seen by the frontend (augments backend data with live UI state)
interface VideoState {
  videoId: string; jobId: string; keyword: string;
  title: string; channelName: string; views: number;
  thumbnailUrl: string; durationSeconds: number; estimatedMb: number;
  status: "queued"|"downloading"|"uploading"|"done"|"failed";
  progress: number; r2Key: string | null;
}

export default function Page() {
  const [phase,      setPhase]      = useState<Phase>("input");
  const [keywords,   setKeywords]   = useState<string[]>([]);
  const [maxResults, setMaxResults] = useState(8);
  const [quality,    setQuality]    = useState("720p");
  const [videos,     setVideos]     = useState<VideoState[]>([]);
  const [summary,    setSummary]    = useState<any>(null);
  // B3 fix: track jobId per keyword so Stop can send PATCH to the right job
  const [currentJobIds, setCurrentJobIds] = useState<string[]>([]);

  const runRef  = useRef(false);
  const stopRef = useRef(false);

  // ── Polling: update storage panel while pipeline is active ────────────────
  useEffect(() => {
    if (!["processing","searching"].includes(phase)) return;
    const id = setInterval(async () => {
      const res = await fetch("/api/pipeline/jobs?summary=1&r2=1");
      const { summary: s } = await res.json();
      setSummary(s);
    }, 3000);
    return () => clearInterval(id);
  }, [phase]);

  // ── Stop: signal frontend immediately + tell backend ─────────────────────
  const handleStop = async () => {
    stopRef.current = true; // halt frontend loop on next tick
    await Promise.all(
      currentJobIds.map(jobId =>
        fetch(`/api/pipeline/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "stopping" }),
        })
      )
    );
  };

  // ── Run pipeline ─────────────────────────────────────────────────────────
  const handleRun = async () => {
    if (runRef.current || keywords.length === 0) return;
    runRef.current  = true;
    stopRef.current = false;
    setVideos([]);
    setCurrentJobIds([]);
    setPhase("searching");

    // Trigger all jobs on the backend
    const res  = await fetch("/api/pipeline/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords, maxResults, quality }),
    });
    const { jobs } = await res.json();
    // B3 fix: store the returned job IDs so Stop can target them
    setCurrentJobIds(jobs.map((j: any) => j.jobId));

    // ... frontend simulation loop (see dashboard artifact for full loop)
    // In production, replace with polling GET /api/pipeline/jobs?summary=1
    // and updating video statuses from the DB rather than simulating locally.

    setPhase("done");
    runRef.current = false;
  };

  const isRunning = ["searching","processing"].includes(phase);
  const done    = videos.filter(v => v.status === "done").length;
  const failed  = videos.filter(v => v.status === "failed").length;
  const total   = videos.length;
  const storedMb = videos.filter(v => v.status === "done").reduce((s,v) => s + v.estimatedMb, 0);

  return (
    <main style={{ minHeight:"100vh", display:"flex", flexDirection:"column" }}>
      {/* Header */}
      <header>...</header>

      <div style={{ flex:1, padding:20, background:"#e8e9eb" }}>
        <div style={{ background:"#fff", borderRadius:16, padding:30, maxWidth:1180, margin:"0 auto", display:"flex", gap:36 }}>

          {/* LEFT: Pipeline flow */}
          <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:0 }}>
            <h1>Pipeline</h1>
            <StepStrip phase={phase} />
            <KeywordInput
              keywords={keywords} onKeywordsChange={setKeywords}
              maxResults={maxResults} onMaxResultsChange={setMaxResults}
              quality={quality} onQualityChange={setQuality}
              isRunning={isRunning}
              onRun={handleRun}
              onStop={handleStop}
              phase={phase}
              activeCount={videos.filter(v => ["downloading","uploading"].includes(v.status)).length}
            />
            {phase === "searching" && <div className="search-state">...</div>}
            {videos.length > 0 && (
              <>
                <VideoGrid videos={videos} />
                <ProgressSummary phase={phase} done={done} total={total} storedMb={storedMb} failed={failed} />
              </>
            )}
          </div>

          <div style={{ width:1, background:"#e2e2e2", flexShrink:0 }} />

          {/* RIGHT: Storage */}
          <div style={{ width:304, flexShrink:0, display:"flex", flexDirection:"column", gap:20 }}>
            <h2>Storage</h2>
            <StorageOverview summary={summary} localStoredMb={storedMb} localFileCount={done} />
            <StatCards downloaded={done} failed={failed} successPct={total > 0 ? Math.round((done/total)*100) : null} />
            <AllocationBars keywords={keywords} videos={videos} />
          </div>
        </div>
      </div>
    </main>
  );
}
```

---

## Phase 4 — Docker + Cloud Run Deployment (2h)

### Dockerfile

```dockerfile
FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 curl ca-certificates \
  && curl -L "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" \
     -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 NODE_OPTIONS="--max-old-space-size=2048"
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### Deploy to Cloud Run

```bash
gcloud run deploy ytdownloader \
  --source . \
  --region asia-southeast1 \
  --memory 4Gi \
  --cpu 2 \
  --timeout 3600 \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 3 \
  --set-env-vars "YOUTUBE_API_KEY_1=...,CLOUDFLARE_ACCOUNT_ID=...,R2_ACCESS_KEY_ID=...,R2_SECRET_ACCESS_KEY=...,R2_BUCKET_NAME=...,NEXT_PUBLIC_SUPABASE_URL=...,SUPABASE_SERVICE_ROLE_KEY=..."
```

---

## Implementation Checklist

### Phase 1 — Foundation
- [ ] Run `supabase-migration.sql` in Supabase SQL Editor
- [ ] Verify `pipeline_jobs` status CHECK includes `'stopping'` and `'stopped'`
- [ ] Verify `pipeline_videos` status default is `'pending'` and CHECK includes `'pending'`
- [ ] Verify both views exist: `pipeline_summary` and `pipeline_video_summary`
- [ ] Create Cloudflare R2 bucket `yt-downloader-corpus`
- [ ] Generate R2 API token (Object Read + Write)
- [ ] Create GCP project → enable YouTube Data API v3 → create API key
- [ ] Fill `.env.local` — all 7 vars set
- [ ] `npm install @aws-sdk/client-s3 @aws-sdk/lib-storage uuid @supabase/supabase-js`
- [ ] `next.config.js` — `output: "standalone"` set (required for Dockerfile)
- [ ] `next.config.js` — `remotePatterns` includes `i.ytimg.com` and `img.youtube.com`

### Phase 2 — Backend
- [ ] `lib/pipeline/youtube-search.ts` — test: `searchYouTubeVideos("shopee affiliate")` returns ≥1 result
- [ ] `lib/pipeline/downloader.ts` — install `yt-dlp` locally; test with a single YouTube URL → produces `.mp4`
- [ ] `lib/pipeline/r2.ts` — test: `pingR2()` returns `{ ok: true }`
- [ ] `lib/pipeline/job-store.ts` — `listVideosByJob()` implemented; test: `createJob` inserts, `getJob` reads, `updateJob` patches
- [ ] `lib/pipeline/orchestrator.ts` — `shouldStop()` called before each video; `cleanupTempFile()` in `finally`
- [ ] `app/api/pipeline/scrape/route.ts` — `MAX_VIDEOS_PER_JOB = 30` cap present; test: POST returns `{ success, jobs: [{ jobId, keyword }] }`
- [ ] `app/api/pipeline/jobs/route.ts` — `GET ?summary=1&r2=1` returns all three fields
- [ ] `app/api/pipeline/jobs/[id]/route.ts` — `GET` returns job + videos; `PATCH { status:"stopping" }` returns 200; returns 409 if already done/failed
- [ ] `app/api/health/route.ts` — `GET /api/health` returns `{ ok, checks: { ytdlp, r2, youtubeApi } }`

### Phase 3 — Dashboard
- [ ] `app/layout.tsx` — DM Sans + DM Mono Google Fonts loaded via `<link>` in `<head>`
- [ ] `next.config.js` — `output: "standalone"` confirmed before build
- [ ] `app/page.tsx` — `currentJobIds` state populated from POST `/api/pipeline/scrape` response
- [ ] `app/page.tsx` — `handleStop()` iterates `currentJobIds` and sends PATCH to each
- [ ] `app/page.tsx` — `stopRef.current = true` called synchronously inside `handleStop`
- [ ] `app/page.tsx` — in-progress video reset to `queued` on frontend when stop detected
- [ ] `app/page.tsx` — polling `useEffect` runs every 3s while phase is `searching` or `processing`; clears on cleanup
- [ ] `StepStrip.tsx` — all 6 phases render; done steps show ✓ in teal `#1a5c60`
- [ ] `KeywordInput.tsx` — Enter adds tag, Backspace removes last, duplicates blocked
- [ ] `KeywordInput.tsx` — Run disabled until `keywords.length > 0` and not running; Stop visible only while `isRunning`
- [ ] `VideoGrid.tsx` — border colour + progress bar colour match video status
- [ ] `ProgressSummary.tsx` — bar colour amber + label "Stopped…" when `phase === "stopped"`
- [ ] `StorageOverview.tsx` + `StatCards.tsx` — show local counts immediately; replace with polled summary when available
- [ ] `AllocationBars.tsx` — bar fill width proportional to highest count, not raw percentage

### Phase 4 — Deployment
- [ ] `docker build -t ytdownloader .` — builds without error
- [ ] `docker run -p 3000:3000 --env-file .env.local ytdownloader` — starts, `GET /api/health` returns 200
- [ ] `docker exec <container> yt-dlp --version` — confirms binary present
- [ ] `docker exec <container> ffmpeg -version` — confirms ffmpeg present
- [ ] `gcloud run deploy ytdownloader --source . --region asia-southeast1 --memory 4Gi --cpu 2 --timeout 3600 --concurrency 1`
- [ ] All 7 env vars set in Cloud Run environment variables
- [ ] Cloud Run URL `/api/health` returns `{ ok: true }` for all 3 checks
- [ ] End-to-end: keyword → Run → video cards update → Stop → remaining videos stay `queued` in Supabase `pipeline_videos` → Run again

---

## Quota Management

| Resource | Limit | Mitigation |
|---|---|---|
| YouTube API v3 | 10,000 units/day | 100 units/search = 100 keywords/day free. Rotate `YOUTUBE_API_KEY_1/2/3` across GCP projects for 3× headroom |
| yt-dlp bot detection | ~50–100 DL/hour | 2–5s jitter built into orchestrator between every video |
| Cloud Run timeout | 3,600s hard limit | `MAX_VIDEOS_PER_JOB = 30` cap in scrape route: 30 × ~90s = ~2,700s — 25% safety buffer. Increase cap only with `--timeout` increase |
| Cloud Run /tmp storage | 512MB–32GB (depends on instance) | `cleanupTempFile()` in `finally` block ensures MP4 deleted immediately after upload |
| R2 free tier | 10GB storage, 10M Class-A ops/month | ~100MB/video → 100 videos = 10GB. Monitor via Cloudflare dashboard |

---

## Known Risks

| Risk | Probability | Mitigation |
|---|---|---|
| YouTube API quota exhausted mid-run | Medium | Key rotation via `YOUTUBE_API_KEY_1/2/3`; cache search results to Supabase to avoid re-searching same keyword |
| yt-dlp format breakage (YouTube changes) | Low–Medium | Dockerfile downloads latest release at build time — rebuild image to get updates |
| Stop signal latency (orchestrator polls between videos) | Low | By design: current video always completes before stop takes effect, avoiding partial R2 uploads |
| Cloud Run cold start (0 min instances) | Medium | First request after idle ~8s. Set `--min-instances 1` if UX requires sub-3s start |
| yt-dlp IP block after high volume | Low | Add `--proxy <endpoint>` flag in `downloader.ts` args array with a residential proxy |
| Duplicate video IDs across keywords in same job | Low | `UNIQUE INDEX idx_videos_unique ON pipeline_videos(job_id, video_id)` rejects duplicate inserts — `recordVideo` will throw; catch and log, don't fail the whole job |

