import { NextRequest, NextResponse } from "next/server";
import { searchYouTubeVideos } from "@/lib/pipeline/youtube-search";

export const maxDuration = 120;

const MAX_VIDEOS_PER_KEYWORD = 30;

export async function POST(req: NextRequest) {
  const {
    keywords,
    maxResults = 10,
    regionCode = "US",
    maxDurationSeconds = 1200,
  } = await req.json();

  if (!Array.isArray(keywords) || !keywords.length) {
    return NextResponse.json({ error: "keywords[] required" }, { status: 400 });
  }

  const cappedMax = Math.min(parseInt(String(maxResults), 10) || 10, MAX_VIDEOS_PER_KEYWORD);
  const trimmed = keywords.map((kw: string) => kw.trim()).filter(Boolean);

  if (!trimmed.length) {
    return NextResponse.json({ error: "At least one keyword required" }, { status: 400 });
  }

  const results = await Promise.all(
    trimmed.map(async (keyword) => {
      const videos = await searchYouTubeVideos(keyword, {
        maxResults: cappedMax,
        regionCode,
        maxDurationSeconds: parseInt(String(maxDurationSeconds), 10) || 0,
      });
      return { keyword, videos };
    })
  );

  const totalFound = results.reduce((sum, row) => sum + row.videos.length, 0);

  return NextResponse.json({ success: true, results, totalFound });
}
