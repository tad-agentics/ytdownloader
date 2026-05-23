import type { VideoState } from "@/components/pipeline/VideoGrid";

interface AllocationBarsProps {
  keywords: string[];
  videos: VideoState[];
  videoSummary?: Array<{
    keyword: string;
    stored_count: number;
    failed_count: number;
    queued_count: number;
  }>;
}

function initials(keyword: string) {
  return keyword
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("");
}

export default function AllocationBars({ keywords, videos, videoSummary }: AllocationBarsProps) {
  const rows = keywords.map((keyword) => {
    const fromVideos = videos.filter((v) => v.keyword === keyword);
    const stored = fromVideos.filter((v) => v.status === "done").length;
    const pending = fromVideos.filter((v) => v.status !== "done" && v.status !== "failed").length;
    const summaryRow = videoSummary?.find((s) => s.keyword === keyword);
    const storedCount = fromVideos.length > 0 ? stored : (summaryRow?.stored_count ?? 0);
    const pendingCount = fromVideos.length > 0 ? pending : (summaryRow?.queued_count ?? 0);
    const total = storedCount + pendingCount;
    const pct = total > 0 ? Math.round((storedCount / total) * 100) : 0;
    return { keyword, storedCount, pendingCount, pct };
  });

  const maxStored = Math.max(...rows.map((r) => r.storedCount), 1);

  return (
    <div>
      <div className="alloc-hdr">
        <div className="alloc-title">Keywords</div>
        <div className="alloc-leg">
          <div className="leg">
            <span className="leg-dot s" />
            Stored
          </div>
          <div className="leg">
            <span className="leg-dot p" />
            Pending
          </div>
        </div>
      </div>
      <div className="alloc-rows">
        {rows.length === 0 ? (
          <span style={{ fontSize: 11, color: "var(--tx3)" }}>Add keywords to see distribution</span>
        ) : (
          rows.map((row) => {
            const w = Math.round((row.storedCount / maxStored) * 62);
            return (
              <div key={row.keyword} className="arow">
                <div className="aic">{initials(row.keyword)}</div>
                <div className="anm">{row.keyword}</div>
                <div className="abar">
                  <div className="afill" style={{ width: `${w}%` }} />
                  <div className="arest" />
                </div>
                <div className="apct">{row.pct}%</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
