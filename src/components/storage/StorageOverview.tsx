interface StorageOverviewProps {
  summary: {
    total_bytes?: number;
    total_videos?: number;
  } | null;
  localStoredMb: number;
  localFileCount: number;
  r2Ok?: boolean;
}

const R2_TOTAL_GB = 100;

export default function StorageOverview({
  summary,
  localStoredMb,
  localFileCount,
  r2Ok,
}: StorageOverviewProps) {
  const summaryBytes = summary?.total_bytes ?? 0;
  const summaryVideos = summary?.total_videos ?? 0;
  const useSummary = summaryBytes > 0 || summaryVideos > 0;

  const storedBytes = useSummary ? summaryBytes : localStoredMb * 1024 * 1024;
  const storedGB = (storedBytes / (1024 * 1024 * 1024)).toFixed(2);
  const fileCount = useSummary ? summaryVideos : localFileCount;
  const availableGB = Math.max(0, R2_TOTAL_GB - parseFloat(storedGB)).toFixed(1);

  return (
    <div className="stor-row">
      <div className="stor-col">
        <div className="stor-lbl">Total stored</div>
        <div className="stor-val">{fileCount > 0 ? `${storedGB} GB` : "—"}</div>
        <div className="stor-sub">
          {fileCount} file{fileCount !== 1 ? "s" : ""}
        </div>
      </div>
      <div className="stor-col">
        <div className="stor-lbl">R2 available</div>
        <div className="stor-val" style={{ color: r2Ok === false ? "#fb923c" : "#4ade80" }}>
          {r2Ok === false ? "—" : `${availableGB} GB`}
        </div>
        <div className="stor-sub">of {R2_TOTAL_GB} GB</div>
      </div>
    </div>
  );
}
