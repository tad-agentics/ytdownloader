import { NextRequest, NextResponse } from "next/server";
import { listStoredVideoIds } from "@/lib/pipeline/job-store";
import { filterToEnglishTranscripts } from "@/lib/pipeline/transcript-probe";
import { searchYouTubeVideos } from "@/lib/pipeline/youtube-search";

export const maxDuration = 300;

const MAX_VIDEOS_PER_KEYWORD = 30;

async function searchKeywordRow(
  keyword: string,
  opts: {
    cappedMax: number;
    fetchPool: number;
    regionCode: string;
    maxDurationSeconds: number;
    storedIds: Set<string>;
    englishCcOnly: boolean;
  }
) {
  const { cappedMax, fetchPool, regionCode, maxDurationSeconds, storedIds, englishCcOnly } = opts;

  const raw = await searchYouTubeVideos(keyword, {
    maxResults: fetchPool,
    regionCode,
    maxDurationSeconds,
    // Do not use videoCaption=closedCaption — it drops auto-generated English CC videos.
    requireCaptions: false,
  });

  const fresh = raw.filter((v) => !storedIds.has(v.videoId));
  const excludedStored = raw.length - fresh.length;

  let videos = fresh;
  let excludedNoCc = 0;
  let probesFailed = 0;

  if (englishCcOnly && fresh.length > 0) {
    const filtered = await filterToEnglishTranscripts(fresh, cappedMax);
    excludedNoCc = filtered.excludedNoCc;
    probesFailed = filtered.probesFailed;
    videos = filtered.videos;
  } else {
    videos = fresh.slice(0, cappedMax);
  }

  return {
    keyword,
    videos,
    excludedStored,
    excludedNoCc,
    probesFailed,
  };
}

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
    ? Math.min(Math.max(cappedMax * 6, cappedMax + 12), MAX_VIDEOS_PER_KEYWORD)
    : excludeStored
      ? Math.min(Math.max(cappedMax * 4, cappedMax + 4), MAX_VIDEOS_PER_KEYWORD)
      : cappedMax;

  const rowOpts = {
    cappedMax,
    fetchPool,
    regionCode,
    maxDurationSeconds: parseInt(String(maxDurationSeconds), 10) || 0,
    storedIds,
    englishCcOnly: Boolean(englishCcOnly),
  };

  const results = englishCcOnly
    ? []
    : await Promise.all(trimmed.map((keyword) => searchKeywordRow(keyword, rowOpts)));

  if (englishCcOnly) {
    for (const keyword of trimmed) {
      results.push(await searchKeywordRow(keyword, rowOpts));
    }
  }

  const totalFound = results.reduce((sum, row) => sum + row.videos.length, 0);
  const totalExcluded = results.reduce((sum, row) => sum + row.excludedStored, 0);
  const totalExcludedNoCc = results.reduce((sum, row) => sum + row.excludedNoCc, 0);
  const totalProbesFailed = results.reduce((sum, row) => sum + row.probesFailed, 0);

  return NextResponse.json({
    success: true,
    results,
    totalFound,
    totalExcluded,
    totalExcludedNoCc,
    totalProbesFailed,
    englishCcOnly: Boolean(englishCcOnly),
  });
}
