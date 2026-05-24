export const DOWNLOAD_CONCURRENCY_OPTIONS = [1, 2, 3] as const;

export type DownloadConcurrency = (typeof DOWNLOAD_CONCURRENCY_OPTIONS)[number];

export function resolveDownloadConcurrency(override?: number): DownloadConcurrency {
  const raw =
    override !== undefined && override !== null
      ? override
      : parseInt(process.env.PIPELINE_DOWNLOAD_CONCURRENCY || "1", 10);

  const n = Number.isFinite(raw) ? Math.trunc(raw) : 1;
  if (n <= 1) return 1;
  if (n >= 3) return 3;
  return n as DownloadConcurrency;
}
