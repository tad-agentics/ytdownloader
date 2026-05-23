import Image from "next/image";

export interface VideoState {
  videoId: string;
  jobId: string;
  keyword: string;
  title: string;
  channelName: string;
  views: number;
  thumbnailUrl: string;
  durationSeconds: number;
  estimatedMb: number;
  status: "queued" | "downloading" | "uploading" | "done" | "failed";
  progress: number;
  r2Key: string | null;
  transcriptStatus: "pending" | "stored" | "missing" | "failed";
  transcriptLang: string | null;
  transcriptUrl: string | null;
}

const fmtNum = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);

const fmtDur = (s: number) =>
  s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function VideoCard({ v }: { v: VideoState }) {
  const colors = ["#dbeafe", "#fce7f3", "#dcfce7", "#fef9c3", "#ede9fe", "#ffedd5"];
  const bg = colors[Math.abs(v.videoId.charCodeAt(0)) % colors.length];
  const uiStatus = v.status === "queued" ? "queued" : v.status;

  return (
    <div className={`vcard status-${uiStatus}`}>
      <div className="vthumb">
        {v.thumbnailUrl ? (
          <Image
            src={v.thumbnailUrl}
            alt=""
            fill
            className="vthumb-bg"
            sizes="170px"
            unoptimized
          />
        ) : (
          <div
            className="vthumb-placeholder"
            style={{ background: `linear-gradient(135deg,${bg},${bg}cc)` }}
          />
        )}
        <span className="vdur">{fmtDur(v.durationSeconds)}</span>
        {v.status !== "queued" && (
          <span className={`vstatus-badge ${v.status}`}>
            {v.status === "downloading"
              ? "↓ DL"
              : v.status === "uploading"
                ? "↑ R2"
                : v.status === "done"
                  ? "✓"
                  : "✗"}
          </span>
        )}
      </div>
      <div className="vprog-bar">
        <div className={`vprog-fill ${v.status}`} style={{ width: `${v.progress}%` }} />
      </div>
      <div className="vinfo">
        <div className="vtitle">{v.title}</div>
        <div className="vmeta">
          <span>{fmtNum(v.views)}</span>
          <span>{v.estimatedMb > 0 ? `${v.estimatedMb} MB` : "—"}</span>
        </div>
        {v.status === "done" && (
          <div className="vtranscript">
            {v.transcriptStatus === "stored" ? (
              v.transcriptUrl ? (
                <a href={v.transcriptUrl} target="_blank" rel="noreferrer" className="vtranscript-link">
                  CC · {v.transcriptLang || "srt"}
                </a>
              ) : (
                <span className="vtranscript-ok">CC · {v.transcriptLang || "srt"}</span>
              )
            ) : v.transcriptStatus === "missing" ? (
              <span className="vtranscript-missing">No transcript</span>
            ) : v.transcriptStatus === "failed" ? (
              <span className="vtranscript-failed">Transcript failed</span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

interface VideoGridProps {
  videos: VideoState[];
}

export default function VideoGrid({ videos }: VideoGridProps) {
  return (
    <div className="vgrid">
      {videos.map((v) => (
        <VideoCard key={`${v.jobId}-${v.videoId}`} v={v} />
      ))}
    </div>
  );
}
