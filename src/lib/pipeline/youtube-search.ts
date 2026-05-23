const BASE = "https://www.googleapis.com/youtube/v3";

const REGION_LANGUAGE: Record<string, string> = {
  US: "en",
  GB: "en",
  AU: "en",
  CA: "en",
  IN: "en",
  SG: "en",
  VN: "vi",
  JP: "ja",
  KR: "ko",
  TH: "th",
  ID: "id",
  DE: "de",
  FR: "fr",
};

export const YOUTUBE_REGION_OPTIONS = [
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "AU", label: "Australia" },
  { code: "SG", label: "Singapore" },
  { code: "IN", label: "India" },
  { code: "JP", label: "Japan" },
  { code: "KR", label: "South Korea" },
  { code: "VN", label: "Vietnam" },
  { code: "TH", label: "Thailand" },
  { code: "ID", label: "Indonesia" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
] as const;

function relevanceLanguageForRegion(regionCode: string): string {
  return REGION_LANGUAGE[regionCode.toUpperCase()] || "en";
}

function getApiKey(): string {
  const keys = [
    process.env.YOUTUBE_API_KEY_1,
    process.env.YOUTUBE_API_KEY_2,
    process.env.YOUTUBE_API_KEY_3,
  ].filter(Boolean) as string[];
  if (keys.length > 0) {
    return keys[Math.floor(Date.now() / 86_400_000) % keys.length];
  }
  const single = process.env.YOUTUBE_API_KEY;
  if (!single) throw new Error("No YOUTUBE_API_KEY set");
  return single;
}

function parseDuration(iso: string): number {
  const m = (iso || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + +(m[3] || 0);
}

export interface YouTubeVideo {
  videoId: string;
  title: string;
  url: string;
  channelName: string;
  publishedAt: string;
  thumbnailUrl: string;
  viewCount: number;
  duration: string;
  durationSeconds: number;
}

export async function searchYouTubeVideos(
  keyword: string,
  options: {
    maxResults?: number;
    regionCode?: string;
    relevanceLanguage?: string;
    order?: "relevance" | "viewCount" | "date";
    videoDuration?: "any" | "short" | "medium" | "long";
    maxDurationSeconds?: number;
  } = {}
): Promise<YouTubeVideo[]> {
  const {
    maxResults = 10,
    regionCode = "US",
    relevanceLanguage,
    order = "relevance",
    videoDuration,
    maxDurationSeconds = 0,
  } = options;
  const language = relevanceLanguage || relevanceLanguageForRegion(regionCode);
  const durationFilter = maxDurationSeconds > 0 ? maxDurationSeconds : 0;
  const apiDuration =
    videoDuration ||
    (durationFilter > 0 && durationFilter <= 240
      ? "short"
      : durationFilter > 0 && durationFilter <= 1200
        ? "medium"
        : "any");
  const fetchCount =
    durationFilter > 0 ? Math.min(Math.max(maxResults * 3, maxResults), 50) : maxResults;
  const key = getApiKey();

  const sp = new URLSearchParams({
    key,
    q: keyword,
    part: "snippet",
    type: "video",
    maxResults: String(fetchCount),
    regionCode,
    relevanceLanguage: language,
    order,
    videoDuration: apiDuration,
    videoEmbeddable: "true",
  });
  const sr = await fetch(`${BASE}/search?${sp}`);
  if (!sr.ok) {
    const e = await sr.json();
    throw new Error(e.error?.message);
  }
  const items: Array<{ id?: { videoId?: string }; snippet: Record<string, unknown> }> =
    (await sr.json()).items || [];
  if (!items.length) return [];

  const ids = items.map((i) => i.id?.videoId).filter(Boolean).join(",");
  const dr = await fetch(
    `${BASE}/videos?${new URLSearchParams({ key, id: ids, part: "snippet,statistics,contentDetails" })}`
  );
  const dm: Record<string, Record<string, unknown>> = {};
  for (const v of (await dr.json()).items || []) dm[v.id as string] = v;

  return items
    .map((item): YouTubeVideo | null => {
      const vid = item.id?.videoId;
      if (!vid) return null;
      const d = dm[vid] || {};
      const contentDetails = d.contentDetails as { duration?: string } | undefined;
      const statistics = d.statistics as { viewCount?: string } | undefined;
      const snippet = item.snippet as {
        title: string;
        channelTitle: string;
        publishedAt: string;
        thumbnails?: { high?: { url?: string } };
      };
      const iso = contentDetails?.duration || "";
      return {
        videoId: vid,
        title: snippet.title,
        url: `https://www.youtube.com/watch?v=${vid}`,
        channelName: snippet.channelTitle,
        publishedAt: snippet.publishedAt,
        thumbnailUrl: snippet.thumbnails?.high?.url || "",
        viewCount: parseInt(statistics?.viewCount || "0", 10),
        duration: iso,
        durationSeconds: parseDuration(iso),
      };
    })
    .filter((v): v is YouTubeVideo => v !== null)
    .filter((v) => !durationFilter || v.durationSeconds <= durationFilter)
    .slice(0, maxResults);
}
