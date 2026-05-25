export const MAX_DURATION_OPTIONS = [
  { seconds: 240, label: "≤4 min" },
  { seconds: 1200, label: "≤20 min" },
  { seconds: 3600, label: "≤60 min" },
  { seconds: 0, label: "Any length" },
] as const;

export const DEFAULT_MAX_DURATION_SECONDS = 1200;

export function downloadTimeoutMs(durationSeconds: number): number {
  const cap = parseInt(process.env.YT_DLP_TIMEOUT_MS || "900000", 10) || 900000;
  const estimated = Math.max(5 * 60 * 1000, durationSeconds * 2 * 1000);
  return Math.min(estimated, cap);
}

export function friendlyDownloadError(error: string | null | undefined): string {
  if (!error) return "Download failed";
  if (/not a bot|Sign in to confirm/i.test(error)) {
    return "YouTube bot check — add YT_DLP cookies";
  }
  if (/timeout/i.test(error)) return "Download timed out";
  if (/429|too many requests/i.test(error)) {
    return "YouTube rate limit — try 1× parallel or retry later";
  }
  if (/Private video|Video unavailable/i.test(error)) return "Video unavailable";
  const trimmed = error.replace(/^yt-dlp exit \d+:\s*/i, "").trim();
  return trimmed.length > 90 ? `${trimmed.slice(0, 87)}…` : trimmed;
}
