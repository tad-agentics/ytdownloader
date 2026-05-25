"use client";

import Image from "next/image";
import { friendlyDownloadError } from "@/lib/pipeline/duration-limits";
import { isUnplayableYouTubeTitle } from "@/lib/pipeline/text-utils";

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
  r2PublicUrl: string | null;
  storedAt: string | null;
  transcriptStatus: "pending" | "stored" | "missing" | "failed";
  transcriptLang: string | null;
  transcriptUrl: string | null;
  transcriptAvailable: boolean | null;
  error: string | null;
}

const fmtNum = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);

const fmtDur = (s: number) =>
  s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function selectionKey(v: VideoState) {
  return `${v.keyword}::${v.videoId}`;
}

function VideoCard({
  v,
  deletable,
  onDelete,
  deleting,
  selectable,
  selected,
  onToggle,
  isTranscriptProbing,
}: {
  v: VideoState;
  deletable?: boolean;
  onDelete?: (v: VideoState) => void;
  deleting?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: (v: VideoState) => void;
  isTranscriptProbing?: boolean;
}) {
  const colors = ["#dbeafe", "#fce7f3", "#dcfce7", "#fef9c3", "#ede9fe", "#ffedd5"];
  const bg = colors[Math.abs(v.videoId.charCodeAt(0)) % colors.length];
  const uiStatus = v.status === "queued" ? "queued" : v.status;
  const hasTranscriptLink = v.transcriptStatus === "stored" && Boolean(v.transcriptUrl);
  const showMediaLinks = v.status === "done" && (v.r2PublicUrl || hasTranscriptLink);
  const unplayableOnYouTube = isUnplayableYouTubeTitle(v.title);

  const handleCardClick = () => {
    if (selectable && onToggle) onToggle(v);
  };

  return (
    <div
      className={`vcard status-${uiStatus}${selectable ? " selectable" : ""}${selected ? " selected" : ""}`}
      onClick={selectable ? handleCardClick : undefined}
      onKeyDown={
        selectable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onToggle?.(v);
              }
            }
          : undefined
      }
      role={selectable ? "button" : undefined}
      tabIndex={selectable ? 0 : undefined}
    >
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
        {selectable && (
          <span className={`vselect-mark${selected ? " on" : ""}`} aria-hidden="true">
            {selected ? "✓" : ""}
          </span>
        )}
        {selectable && v.transcriptAvailable === null && isTranscriptProbing && (
          <span className="vtranscript-badge pending" title="Checking English CC">
            CC …
          </span>
        )}
        {selectable && v.transcriptAvailable === true && (
          <span
            className="vtranscript-badge yes"
            title={`English CC available${v.transcriptLang ? ` (${v.transcriptLang})` : ""}`}
          >
            CC ✓
          </span>
        )}
        {selectable && v.transcriptAvailable === false && (
          <span className="vtranscript-badge no" title="No English captions detected">
            CC ✗
          </span>
        )}
        {selectable && v.transcriptAvailable === null && !isTranscriptProbing && (
          <span
            className="vtranscript-badge unknown"
            title="CC check failed (timeout or rate limit). This video may still have captions on YouTube."
          >
            CC ?
          </span>
        )}
        <span className="vdur">{fmtDur(v.durationSeconds)}</span>
        {!selectable && v.status !== "queued" && (
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
      {!selectable && (
        <div className="vprog-bar">
          <div className={`vprog-fill ${v.status}`} style={{ width: `${v.progress}%` }} />
        </div>
      )}
      <div className="vinfo">
        <div className="vtitle">{v.title}</div>
        <div className="vmeta">
          <span>{fmtNum(v.views)}</span>
          <span>{v.estimatedMb > 0 ? `${v.estimatedMb} MB` : "—"}</span>
        </div>
        {selectable && v.keyword && (
          <div className="vkeyword-tag">{v.keyword}</div>
        )}
        {selectable && unplayableOnYouTube && (
          <div className="vunplayable" title="YouTube cannot play this video (removed, private, or blocked).">
            Not playable on YouTube — skip this result
          </div>
        )}
        {v.status === "failed" && v.error && (
          <div className="verror" title={v.error}>
            {friendlyDownloadError(v.error)}
          </div>
        )}
        {showMediaLinks && (
          <div className="vmedia-links">
            {v.r2PublicUrl ? (
              <a
                href={v.r2PublicUrl}
                target="_blank"
                rel="noreferrer"
                className="vmedia-btn video"
                onClick={(e) => e.stopPropagation()}
              >
                Video ↗
              </a>
            ) : null}
            {hasTranscriptLink ? (
              <a
                href={v.transcriptUrl!}
                target="_blank"
                rel="noreferrer"
                className="vmedia-btn transcript"
                onClick={(e) => e.stopPropagation()}
              >
                Transcript{v.transcriptLang ? ` · ${v.transcriptLang}` : ""} ↗
              </a>
            ) : v.transcriptStatus === "missing" ? (
              <span className="vmedia-muted">No transcript</span>
            ) : v.transcriptStatus === "failed" ? (
              <span className="vmedia-muted">Transcript failed</span>
            ) : null}
          </div>
        )}
        {deletable && v.status === "done" && onDelete && (
          <button
            type="button"
            className="vdel-action"
            disabled={deleting}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(v);
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>
    </div>
  );
}

interface VideoGridProps {
  videos: VideoState[];
  deletable?: boolean;
  onDelete?: (video: VideoState) => void;
  deletingKey?: string | null;
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onToggle?: (video: VideoState) => void;
  probingKeys?: Set<string>;
}

export default function VideoGrid({
  videos,
  deletable,
  onDelete,
  deletingKey,
  selectable,
  selectedKeys,
  onToggle,
  probingKeys,
}: VideoGridProps) {
  return (
    <div className="vgrid">
      {videos.map((v) => (
        <VideoCard
          key={`${v.jobId || v.keyword}-${v.videoId}`}
          v={v}
          deletable={deletable}
          onDelete={onDelete}
          deleting={deletingKey === `${v.jobId}-${v.videoId}`}
          selectable={selectable}
          selected={selectedKeys?.has(selectionKey(v))}
          onToggle={onToggle}
          isTranscriptProbing={probingKeys?.has(selectionKey(v))}
        />
      ))}
    </div>
  );
}

export { selectionKey };
