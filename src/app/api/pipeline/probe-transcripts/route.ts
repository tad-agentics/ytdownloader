import { NextRequest, NextResponse } from "next/server";
import {
  enrichVideosWithTranscriptAvailability,
  MAX_PROBE_BATCH,
} from "@/lib/pipeline/transcript-probe";

export const maxDuration = 300;

type ProbeInput = {
  videoId: string;
  url: string;
  keyword?: string;
};

export async function POST(req: NextRequest) {
  try {
    const { videos } = await req.json();

    if (!Array.isArray(videos) || !videos.length) {
      return NextResponse.json({ error: "videos[] required" }, { status: 400 });
    }

    const rows = (videos as ProbeInput[]).filter((v) => v?.videoId && v?.url).slice(0, MAX_PROBE_BATCH);
    const enriched = await enrichVideosWithTranscriptAvailability(rows, { concurrency: 2 });

    return NextResponse.json({
      success: true,
      probes: enriched.map((v) => ({
        videoId: v.videoId,
        keyword: (v as ProbeInput).keyword,
        transcriptAvailable: v.transcriptAvailable,
        transcriptLang: v.transcriptLang,
      })),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
