import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { runDownloadJob } from "@/lib/pipeline/orchestrator";
import type { VideoQuality } from "@/lib/pipeline/downloader";
import type { YouTubeVideo } from "@/lib/pipeline/youtube-search";

type SelectionRow = {
  keyword: string;
  videos: YouTubeVideo[];
};

export async function POST(req: NextRequest) {
  const {
    selections,
    quality = "720p",
    regionCode = "US",
    concurrency,
  } = await req.json();

  if (!Array.isArray(selections) || !selections.length) {
    return NextResponse.json({ error: "selections[] required" }, { status: 400 });
  }

  const jobs: Array<{ jobId: string; keyword: string; videoCount: number }> = [];

  for (const row of selections as SelectionRow[]) {
    const keyword = row.keyword?.trim();
    const videos = Array.isArray(row.videos) ? row.videos : [];
    if (!keyword || !videos.length) continue;

    const jobId = uuidv4();
    jobs.push({ jobId, keyword, videoCount: videos.length });

    runDownloadJob(jobId, keyword, videos, {
      quality: quality as VideoQuality,
      regionCode,
      concurrency,
    }).catch((err) => console.error(`Job ${jobId} failed:`, err));
  }

  if (!jobs.length) {
    return NextResponse.json({ error: "No videos selected for download" }, { status: 400 });
  }

  return NextResponse.json({ success: true, jobs });
}
