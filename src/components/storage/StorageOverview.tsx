interface StorageOverviewProps {
  summary: {
    total_bytes?: number;
    total_videos?: number;
  } | null;
  r2Storage: {
    totalBytes: number;
    objectCount: number;
  } | null;
  storageLoaded: boolean;
  localStoredMb: number;
  localFileCount: number;
  r2Ok?: boolean;
}

const R2_TOTAL_GB = 100;

function bytesToGb(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}

export default function StorageOverview({
  summary,
  r2Storage,
  storageLoaded,
  localStoredMb,
  localFileCount,
  r2Ok,
}: StorageOverviewProps) {
  const summaryBytes = summary?.total_bytes ?? 0;
  const summaryVideos = summary?.total_videos ?? 0;
  const r2Bytes = r2Storage?.totalBytes ?? 0;
  const r2Count = r2Storage?.objectCount ?? 0;

  const storedBytes =
    r2Bytes > 0
      ? r2Bytes
      : summaryBytes > 0
        ? summaryBytes
        : localStoredMb * 1024 * 1024;

  const fileCount =
    r2Count > 0 ? r2Count : summaryVideos > 0 ? summaryVideos : localFileCount;

  const hasData = storageLoaded && (storedBytes > 0 || fileCount > 0);
  const storedGB = bytesToGb(storedBytes);
  const availableGB = Math.max(0, R2_TOTAL_GB - parseFloat(storedGB)).toFixed(1);

  return (
    <div className="stor-row">
      <div className="stor-col">
        <div className="stor-lbl">Total stored</div>
        <div className="stor-val">{hasData ? `${storedGB} GB` : storageLoaded ? "—" : "…"}</div>
        <div className="stor-sub">
          {hasData ? `${fileCount} file${fileCount !== 1 ? "s" : ""}` : storageLoaded ? "0 files" : "loading"}
        </div>
      </div>
      <div className="stor-col">
        <div className="stor-lbl">R2 available</div>
        <div className="stor-val" style={{ color: r2Ok === false ? "#fb923c" : "#4ade80" }}>
          {r2Ok === false ? "—" : storageLoaded ? `${availableGB} GB` : "…"}
        </div>
        <div className="stor-sub">of {R2_TOTAL_GB} GB</div>
      </div>
    </div>
  );
}
