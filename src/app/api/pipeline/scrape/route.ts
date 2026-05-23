import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { runPipelineJob } from "@/lib/pipeline/orchestrator";
import type { VideoQuality } from "@/lib/pipeline/downloader";

const MAX_VIDEOS_PER_JOB = 30;

export async function POST(req: NextRequest) {
  const { keywords, maxResults = 10, quality = "720p", regionCode = "US" } = await req.json();
  if (!Array.isArray(keywords) || !keywords.length) {
    return NextResponse.json({ error: "keywords[] required" }, { status: 400 });
  }

  const cappedMax = Math.min(parseInt(String(maxResults), 10) || 10, MAX_VIDEOS_PER_JOB);

  const jobs = keywords
    .map((kw: string) => ({ jobId: uuidv4(), keyword: kw.trim() }))
    .filter((j) => j.keyword.length > 0);

  for (const { jobId, keyword } of jobs) {
    runPipelineJob(jobId, keyword, {
      maxResults: cappedMax,
      quality: quality as VideoQuality,
      regionCode,
    }).catch((err) => console.error(`Job ${jobId} failed:`, err));
  }

  return NextResponse.json({ success: true, jobs });
}
