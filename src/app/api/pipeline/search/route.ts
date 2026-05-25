import { NextRequest, NextResponse } from "next/server";
import { listStoredVideoIds } from "@/lib/pipeline/job-store";
import { filterToEnglishTranscripts } from "@/lib/pipeline/transcript-probe";
import { searchYouTubeVideos } from "@/lib/pipeline/youtube-search";

export const maxDuration = 300;

const MAX_VIDEOS_PER_KEYWORD = 30;

export async function POST(req: NextRequest) {
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
  const fetchPool = englishCcOnly
    ? Math.min(Math.max(cappedMax * 4, cappedMax + 8), MAX_VIDEOS_PER_KEYWORD)
    : excludeStored
      ? Math.min(Math.max(cappedMax * 4, cappedMax + 4), MAX_VIDEOS_PER_KEYWORD)
      : cappedMax;

  const results = await Promise.all(
    trimmed.map(async (keyword) => {
      const raw = await searchYouTubeVideos(keyword, {
        maxResults: fetchPool,
        regionCode,
        maxDurationSeconds: parseInt(String(maxDurationSeconds), 10) || 0,
        requireCaptions: Boolean(englishCcOnly),
      });

      const fresh = raw.filter((v) => !storedIds.has(v.videoId));
      const excludedStored = raw.length - fresh.length;

      let videos = fresh;
      let excludedNoCc = 0;

      if (englishCcOnly && fresh.length > 0) {
        const filtered = await filterToEnglishTranscripts(fresh, cappedMax);
        excludedNoCc = filtered.excludedNoCc;
        videos = filtered.videos;
      } else {
        videos = fresh.slice(0, cappedMax);
      }

      return {
        keyword,
        videos,
        excludedStored,
        excludedNoCc,
      };
    })
  );

  const totalFound = results.reduce((sum, row) => sum + row.videos.length, 0);
  const totalExcluded = results.reduce((sum, row) => sum + row.excludedStored, 0);
  const totalExcludedNoCc = results.reduce((sum, row) => sum + row.excludedNoCc, 0);

  return NextResponse.json({
    success: true,
    results,
    totalFound,
    totalExcluded,
    totalExcludedNoCc,
    englishCcOnly: Boolean(englishCcOnly),
  });
}
