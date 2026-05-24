import { NextRequest, NextResponse } from "next/server";
import { listJobs, getDashboardSummary, getVideoSummaryByKeyword, listStoredVideos } from "@/lib/pipeline/job-store";
import { pingR2, getR2StorageStats } from "@/lib/pipeline/r2";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const wantSummary = searchParams.get("summary") === "1";
  const wantR2 = searchParams.get("r2") === "1";
  const [jobs, summary, r2, videoSummary, r2Storage, history] = await Promise.all([
    listJobs(100),
    wantSummary ? getDashboardSummary() : Promise.resolve(null),
    wantR2 ? pingR2() : Promise.resolve(null),
    wantSummary ? getVideoSummaryByKeyword() : Promise.resolve(null),
    wantR2 ? getR2StorageStats().catch(() => null) : Promise.resolve(null),
    wantSummary ? listStoredVideos(50) : Promise.resolve(null),
  ]);
  return NextResponse.json({ jobs, summary, r2, videoSummary, r2Storage, history });
}
