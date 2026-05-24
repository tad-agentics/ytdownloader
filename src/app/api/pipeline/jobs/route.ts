import { NextRequest, NextResponse } from "next/server";
import { listJobs, getDashboardSummary, getVideoSummaryByKeyword } from "@/lib/pipeline/job-store";
import { pingR2, getR2StorageStats } from "@/lib/pipeline/r2";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const wantR2 = searchParams.get("r2") === "1";
  const [jobs, summary, r2, videoSummary, r2Storage] = await Promise.all([
    listJobs(100),
    searchParams.get("summary") === "1" ? getDashboardSummary() : Promise.resolve(null),
    wantR2 ? pingR2() : Promise.resolve(null),
    searchParams.get("summary") === "1" ? getVideoSummaryByKeyword() : Promise.resolve(null),
    wantR2 ? getR2StorageStats().catch(() => null) : Promise.resolve(null),
  ]);
  return NextResponse.json({ jobs, summary, r2, videoSummary, r2Storage });
}
