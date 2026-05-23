import { NextRequest, NextResponse } from "next/server";
import { listJobs, getDashboardSummary, getVideoSummaryByKeyword } from "@/lib/pipeline/job-store";
import { pingR2 } from "@/lib/pipeline/r2";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const [jobs, summary, r2, videoSummary] = await Promise.all([
    listJobs(100),
    searchParams.get("summary") === "1" ? getDashboardSummary() : Promise.resolve(null),
    searchParams.get("r2") === "1" ? pingR2() : Promise.resolve(null),
    searchParams.get("summary") === "1" ? getVideoSummaryByKeyword() : Promise.resolve(null),
  ]);
  return NextResponse.json({ jobs, summary, r2, videoSummary });
}
