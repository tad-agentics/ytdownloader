import { NextRequest, NextResponse } from "next/server";
import { enrichVideosWithTranscriptAvailability } from "@/lib/pipeline/transcript-probe";

export const maxDuration = 300;

type ProbeInput = {
  videoId: string;
  url: string;
  keyword?: string;
};

export async function POST(req: NextRequest) {
  const { videos } = await req.json();

  if (!Array.isArray(videos) || !videos.length) {
    return NextResponse.json({ error: "videos[] required" }, { status: 400 });
  }

  const rows = (videos as ProbeInput[]).filter((v) => v?.videoId && v?.url);
  const enriched = await enrichVideosWithTranscriptAvailability(rows, { concurrency: 8 });

  return NextResponse.json({
    success: true,
    probes: enriched.map((v) => ({
      videoId: v.videoId,
      keyword: v.keyword,
      transcriptAvailable: v.transcriptAvailable,
      transcriptLang: v.transcriptLang,
    })),
  });
}
