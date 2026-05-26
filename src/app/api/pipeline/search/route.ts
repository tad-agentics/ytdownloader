import { NextRequest, NextResponse } from "next/server";
import { listStoredVideoIds } from "@/lib/pipeline/job-store";
import { searchYouTubeVideos } from "@/lib/pipeline/youtube-search";

export const maxDuration = 120;

const MAX_VIDEOS_PER_KEYWORD = 30;

function parseMaxDurationSeconds(value: unknown, fallback = 1200): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function searchErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const quotaExceeded = /quota/i.test(message);
  return NextResponse.json(
    {
      error: quotaExceeded
        ? "YouTube API daily quota exceeded. Add YOUTUBE_API_KEY_2/_3 in .env.local, wait until quota resets (midnight Pacific), or turn off English CC only and retry later."
        : message || "Search failed",
      code: quotaExceeded ? "youtube_quota_exceeded" : "search_failed",
    },
    { status: quotaExceeded ? 503 : 500 }
  );
}

export async function POST(req: NextRequest) {
  try {
    const {
      keywords,
      maxResults = 10,
      regionCode = "US",
      maxDurationSeconds = 1200,
      excludeStored = true,
      englishCcOnly = true,
    } = await req.json();

    if (!Array.isArray(keywords) || !keywords.length) {
      return NextResponse.json({ error: "keywords[] required" }, { status: 400 });
    }

    const cappedMax = Math.min(parseInt(String(maxResults), 10) || 10, MAX_VIDEOS_PER_KEYWORD);
    const trimmed = keywords.map((kw: string) => kw.trim()).filter(Boolean);

    if (!trimmed.length) {
      return NextResponse.json({ error: "At least one keyword required" }, { status: 400 });
    }

    const storedIds = excludeStored !== false ? await listStoredVideoIds() : new Set<string>();
    const ccOnly = Boolean(englishCcOnly);
    const fetchPool = ccOnly
      ? Math.min(Math.max(cappedMax * 2, cappedMax + 4), 20)
      : excludeStored
        ? Math.min(Math.max(cappedMax * 4, cappedMax + 4), MAX_VIDEOS_PER_KEYWORD)
        : cappedMax;

    const results = await Promise.all(
      trimmed.map(async (keyword) => {
        const raw = await searchYouTubeVideos(keyword, {
          maxResults: fetchPool,
          regionCode,
          maxDurationSeconds: parseMaxDurationSeconds(maxDurationSeconds),
          requireCaptions: false,
        });

        const fresh = raw.filter((v) => !storedIds.has(v.videoId));
        const excludedStored = raw.length - fresh.length;

        return {
          keyword,
          videos: ccOnly ? fresh : fresh.slice(0, cappedMax),
          excludedStored,
        };
      })
    );

    const totalFound = results.reduce((sum, row) => sum + row.videos.length, 0);
    const totalExcluded = results.reduce((sum, row) => sum + row.excludedStored, 0);

    return NextResponse.json({
      success: true,
      results,
      totalFound,
      totalExcluded,
      englishCcOnly: ccOnly,
      targetPerKeyword: cappedMax,
    });
  } catch (err: unknown) {
    console.error("Search API error:", err);
    return searchErrorResponse(err);
  }
}
