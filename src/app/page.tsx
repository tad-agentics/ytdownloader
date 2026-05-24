"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import StepStrip, { type Phase } from "@/components/pipeline/StepStrip";
import KeywordInput from "@/components/pipeline/KeywordInput";
import VideoGrid, { type VideoState, selectionKey } from "@/components/pipeline/VideoGrid";
import DeleteConfirmModal from "@/components/pipeline/DeleteConfirmModal";
import OnboardingModal, { ONBOARDING_STORAGE_KEY } from "@/components/pipeline/OnboardingModal";
import ProgressSummary from "@/components/pipeline/ProgressSummary";
import StorageOverview from "@/components/storage/StorageOverview";
import StatCards from "@/components/storage/StatCards";
import AllocationBars from "@/components/storage/AllocationBars";
import type { PipelineJob, PipelineVideo } from "@/lib/pipeline/types";
import type { YouTubeVideo } from "@/lib/pipeline/youtube-search";
import { YOUTUBE_REGION_OPTIONS } from "@/lib/pipeline/youtube-search";
import {
  DEFAULT_MAX_DURATION_SECONDS,
  MAX_DURATION_OPTIONS,
} from "@/lib/pipeline/duration-limits";

const TERMINAL_JOB_STATUSES = ["done", "failed", "stopped"];

function mapSearchVideo(keyword: string, v: YouTubeVideo): VideoState {
  return {
    videoId: v.videoId,
    jobId: "",
    keyword,
    title: v.title,
    channelName: v.channelName,
    views: v.viewCount,
    thumbnailUrl: v.thumbnailUrl || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
    durationSeconds: v.durationSeconds,
    estimatedMb: Math.max(1, Math.round(v.durationSeconds / 10)),
    status: "queued",
    progress: 0,
    r2Key: null,
    r2PublicUrl: null,
    storedAt: null,
    transcriptStatus: "pending",
    transcriptLang: null,
    transcriptUrl: null,
    error: null,
  };
}

function mapDbVideo(v: PipelineVideo): VideoState {
  const statusMap: Record<string, VideoState["status"]> = {
    pending: "queued",
    queued: "queued",
    downloading: "downloading",
    uploading: "uploading",
    stored: "done",
    failed: "failed",
  };
  const status = statusMap[v.status] || "queued";

  return {
    videoId: v.video_id,
    jobId: v.job_id,
    keyword: v.keyword,
    title: v.title || "",
    channelName: v.channel || "",
    views: v.view_count,
    thumbnailUrl: `https://i.ytimg.com/vi/${v.video_id}/hqdefault.jpg`,
    durationSeconds: v.duration_seconds,
    estimatedMb: v.file_size_bytes
      ? Math.round((v.file_size_bytes / 1024 / 1024) * 10) / 10
      : Math.max(1, Math.round(v.duration_seconds / 10)),
    status,
    progress: status === "done" ? 100 : 0,
    r2Key: v.r2_key,
    r2PublicUrl: v.r2_public_url,
    storedAt: v.created_at,
    transcriptStatus: v.transcript_status || "pending",
    transcriptLang: v.transcript_lang,
    transcriptUrl: v.transcript_public_url,
    error: v.error,
  };
}

function mergeVideos(prev: VideoState[], incoming: VideoState[]): VideoState[] {
  const prevMap = new Map(prev.map((v) => [`${v.jobId}-${v.videoId}`, v]));
  return incoming.map((v) => {
    const old = prevMap.get(`${v.jobId}-${v.videoId}`);
    if (!old) return v;
    if (old.status === v.status && (v.status === "downloading" || v.status === "uploading")) {
      return { ...v, progress: Math.max(v.progress, old.progress) };
    }
    if (v.status === "done") return { ...v, progress: 100 };
    if (v.status === "failed") return { ...v, progress: 0 };
    return v;
  });
}

function derivePhase(jobs: PipelineJob[], videoCount: number, stopping: boolean): Phase {
  if (stopping && jobs.every((j) => TERMINAL_JOB_STATUSES.includes(j.status))) {
    return "stopped";
  }
  if (!jobs.length) return "input";
  if (jobs.some((j) => j.status === "searching")) return "searching";
  if (jobs.some((j) => ["downloading", "uploading", "stopping"].includes(j.status))) {
    return "processing";
  }
  if (jobs.every((j) => j.status === "stopped")) return "stopped";
  if (jobs.every((j) => TERMINAL_JOB_STATUSES.includes(j.status))) {
    return jobs.some((j) => j.status === "stopped") ? "stopped" : "done";
  }
  if (videoCount > 0) return "processing";
  return "searching";
}

export default function Page() {
  const [phase, setPhase] = useState<Phase>("input");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [maxResults, setMaxResults] = useState(8);
  const [maxDurationSeconds, setMaxDurationSeconds] = useState(DEFAULT_MAX_DURATION_SECONDS);
  const [quality, setQuality] = useState("720p");
  const [regionCode, setRegionCode] = useState("US");
  const [videos, setVideos] = useState<VideoState[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [r2Storage, setR2Storage] = useState<{ totalBytes: number; objectCount: number } | null>(
    null
  );
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [videoSummary, setVideoSummary] = useState<
    Array<{
      keyword: string;
      stored_count: number;
      failed_count: number;
      queued_count: number;
      transcript_count?: number;
    }>
  >([]);
  const [historyVideos, setHistoryVideos] = useState<VideoState[]>([]);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VideoState | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [searchResults, setSearchResults] = useState<Array<{ keyword: string; videos: YouTubeVideo[] }>>(
    []
  );
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [currentJobIds, setCurrentJobIds] = useState<string[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [health, setHealth] = useState<{
    youtubeApi?: "ok" | "unconfigured" | "error";
    r2?: "ok" | "unconfigured" | "error";
    supabase?: "ok" | "unconfigured" | "error";
    ytdlpCookies?: "ok" | "missing";
  }>({});

  const runRef = useRef(false);
  const stopRef = useRef(false);
  const jobIdsRef = useRef<string[]>([]);
  const phaseRef = useRef<Phase>("input");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data) => {
        const status = (name: string) => data.checks?.[name]?.status as
          | "ok"
          | "unconfigured"
          | "error"
          | undefined;
        setHealth({
          youtubeApi: status("youtubeApi"),
          r2: status("r2"),
          supabase: status("supabase"),
          ytdlpCookies: data.checks?.ytdlpCookies?.status === "ok" ? "ok" : "missing",
        });
      })
      .catch(() => {});
  }, []);

  const refreshStorage = useCallback(async () => {
    const res = await fetch("/api/pipeline/jobs?summary=1&r2=1");
    const data = await res.json();
    if (data.summary) setSummary(data.summary);
    if (data.videoSummary) setVideoSummary(data.videoSummary);
    if (data.r2Storage) setR2Storage(data.r2Storage);
    if (Array.isArray(data.history)) {
      setHistoryVideos(data.history.map((v: PipelineVideo) => mapDbVideo(v)));
    }
    if (data.r2) setHealth((h) => ({ ...h, r2: data.r2.ok ? "ok" : data.r2.configured === false ? "unconfigured" : "error" }));
    setStorageLoaded(true);
  }, []);

  useEffect(() => {
    refreshStorage();
  }, [refreshStorage]);

  useEffect(() => {
    try {
      if (localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "done") {
        setShowOnboarding(true);
      }
    } catch {
      setShowOnboarding(true);
    }
  }, []);

  const completeOnboarding = () => {
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, "done");
    } catch {
      /* private browsing */
    }
    setShowOnboarding(false);
  };

  const pollJobs = useCallback(async (): Promise<boolean> => {
    const ids = jobIdsRef.current;
    if (!ids.length) return runRef.current;

    const results = await Promise.all(
      ids.map((id) => fetch(`/api/pipeline/jobs/${id}`).then((r) => r.json()))
    );

    const jobs: PipelineJob[] = results.map((r) => r.job).filter(Boolean);
    const incoming = results.flatMap((r) => (r.videos || []).map(mapDbVideo));

    setVideos((prev) => mergeVideos(prev, incoming));
    setPhase(derivePhase(jobs, incoming.length, stopRef.current));

    const allTerminal = jobs.length > 0 && jobs.every((j) => TERMINAL_JOB_STATUSES.includes(j.status));
    if (allTerminal) {
      runRef.current = false;
      if (stopRef.current) setPhase("stopped");
      await refreshStorage();
      return false;
    }

    return true;
  }, [refreshStorage]);

  useEffect(() => {
    if (!isPolling) return;
    const tick = async () => {
      const keepPolling = await pollJobs();
      await refreshStorage();
      if (!keepPolling) setIsPolling(false);
    };
    const id = setInterval(tick, 3000);
    tick();
    return () => clearInterval(id);
  }, [isPolling, pollJobs, refreshStorage]);

  useEffect(() => {
    if (!isPolling) return;
    const id = setInterval(() => {
      setVideos((prev) =>
        prev.map((v) => {
          if (v.status === "downloading") {
            const step = Math.floor(Math.random() * 18 + 8);
            return { ...v, progress: Math.min(v.progress + step, 90) };
          }
          if (v.status === "uploading") {
            const step = Math.floor(Math.random() * 22 + 12);
            return { ...v, progress: Math.min(v.progress + step, 95) };
          }
          return v;
        })
      );
    }, 120);
    return () => clearInterval(id);
  }, [isPolling]);

  const handleStop = async () => {
    stopRef.current = true;
    setVideos((prev) =>
      prev.map((v) =>
        ["downloading", "uploading"].includes(v.status)
          ? { ...v, status: "queued", progress: 0 }
          : v
      )
    );
    setPhase("stopped");

    await Promise.all(
      currentJobIds.map((jobId) =>
        fetch(`/api/pipeline/jobs/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "stopping" }),
        })
      )
    );
  };

  const handleReset = () => {
    stopRef.current = false;
    runRef.current = false;
    jobIdsRef.current = [];
    setCurrentJobIds([]);
    setIsPolling(false);
    setVideos([]);
    setSearchResults([]);
    setSelectedKeys(new Set());
    setPhase("input");
    void refreshStorage();
  };

  const confirmDeleteVideo = async () => {
    if (!deleteTarget) return;
    const v = deleteTarget;
    const key = `${v.jobId}-${v.videoId}`;
    setDeletingKey(key);
    try {
      const res = await fetch(`/api/pipeline/videos/${v.jobId}/${v.videoId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(typeof data.error === "string" ? data.error : "Delete failed");
        return;
      }

      setHistoryVideos((prev) =>
        prev.filter((h) => !(h.jobId === v.jobId && h.videoId === v.videoId))
      );
      setVideos((prev) =>
        prev.filter((h) => !(h.jobId === v.jobId && h.videoId === v.videoId))
      );
      setDeleteTarget(null);
      await refreshStorage();
    } finally {
      setDeletingKey(null);
    }
  };

  const handleDeleteVideo = (v: VideoState) => {
    setDeleteTarget(v);
  };

  const toggleVideoSelection = (v: VideoState) => {
    const key = selectionKey(v);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSearch = async () => {
    if (runRef.current || keywords.length === 0) return;
    runRef.current = true;
    stopRef.current = false;
    setVideos([]);
    setSearchResults([]);
    setSelectedKeys(new Set());
    setPhase("searching");

    try {
      const res = await fetch("/api/pipeline/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, maxResults, regionCode, maxDurationSeconds }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPhase("input");
        return;
      }

      const results: Array<{ keyword: string; videos: YouTubeVideo[] }> = data.results || [];
      setSearchResults(results);
      const mapped = results.flatMap((row) => row.videos.map((v) => mapSearchVideo(row.keyword, v)));
      setVideos(mapped);
      setSelectedKeys(new Set(mapped.map((v) => selectionKey(v))));
      setPhase(mapped.length ? "selecting" : "input");
    } finally {
      runRef.current = false;
    }
  };

  const handleDownloadSelected = async () => {
    if (runRef.current || selectedKeys.size === 0) return;
    runRef.current = true;
    stopRef.current = false;

    const selections = searchResults
      .map((row) => ({
        keyword: row.keyword,
        videos: row.videos.filter((v) => selectedKeys.has(`${row.keyword}::${v.videoId}`)),
      }))
      .filter((row) => row.videos.length > 0);

    if (!selections.length) {
      runRef.current = false;
      return;
    }

    setPhase("processing");
    setVideos([]);
    jobIdsRef.current = [];
    setCurrentJobIds([]);

    const res = await fetch("/api/pipeline/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selections, quality, regionCode }),
    });
    const data = await res.json();
    if (!res.ok) {
      runRef.current = false;
      setPhase("selecting");
      return;
    }

    const ids = (data.jobs || []).map((j: { jobId: string }) => j.jobId);
    jobIdsRef.current = ids;
    setCurrentJobIds(ids);
    setIsPolling(true);
  };

  const isRunning = phase === "searching" || phase === "processing";
  const showSelection = phase === "selecting" && videos.length > 0;
  const showActiveRun = videos.length > 0 && ["processing", "done", "stopped"].includes(phase);
  const historyToShow = historyVideos.filter(
    (h) => !showActiveRun || !videos.some((v) => v.videoId === h.videoId && v.jobId === h.jobId)
  );
  const showHistory = historyToShow.length > 0 && !isRunning && phase !== "selecting";
  const summaryDownloaded = Number(summary?.total_videos ?? 0);
  const summaryFailed = videoSummary.reduce((sum, row) => sum + (row.failed_count ?? 0), 0);
  const summarySuccessPct =
    summaryDownloaded + summaryFailed > 0
      ? Math.round((summaryDownloaded / (summaryDownloaded + summaryFailed)) * 100)
      : null;
  const done = videos.filter((v) => v.status === "done").length;
  const failed = videos.filter((v) => v.status === "failed").length;
  const transcripts = videos.filter((v) => v.transcriptStatus === "stored").length;
  const total = videos.length;
  const active = videos.filter((v) => ["downloading", "uploading"].includes(v.status)).length;
  const storedMb = videos
    .filter((v) => v.status === "done")
    .reduce((s, v) => s + v.estimatedMb, 0);

  const serviceLabel = (state?: "ok" | "unconfigured" | "error", labels?: { ok: string; unconfigured: string; error: string }) => {
    if (state === "ok") return labels?.ok ?? "ok";
    if (state === "unconfigured") return labels?.unconfigured ?? "not configured";
    return labels?.error ?? "offline";
  };

  const dotClass = (state?: "ok" | "unconfigured" | "error") =>
    state === "ok" ? "on" : state === "unconfigured" ? "muted" : "warn";

  const showProgress = phase === "processing" || phase === "done" || phase === "stopped";

  return (
    <main className="root">
      <header className="hdr">
        <div className="logo">
          <div className="lmark">
            <svg viewBox="0 0 16 16" className="licon">
              <polygon points="8,1 15,5 15,11 8,15 1,11 1,5" />
              <line x1="8" y1="1" x2="8" y2="15" />
              <line x1="1" y1="5" x2="15" y2="11" />
              <line x1="15" y1="5" x2="1" y2="11" />
            </svg>
          </div>
          <span className="lname">
            YT<span>Downloader</span>
          </span>
        </div>
        <div className="hbadges">
          <div className="hbadge">
            <span className={`hdot ${dotClass(health.youtubeApi)}`} />
            YT API · {serviceLabel(health.youtubeApi, { ok: "active", unconfigured: "not configured", error: "offline" })}
          </div>
          <div className="hbadge">
            <span className={`hdot ${dotClass(health.r2)}`} />
            R2 · {serviceLabel(health.r2, { ok: "connected", unconfigured: "not configured", error: "offline" })}
          </div>
          <div className="hpill">{regionCode} · {quality}</div>
        </div>
      </header>

      <div className="page">
        <div className="card">
          <div className="left">
            <div className="pg-title">Pipeline</div>
            <StepStrip phase={phase} />
            {health.ytdlpCookies === "missing" && phase === "input" && (
              <div className="cookie-warn">
                YouTube downloads need cookies on Cloud Run. Export <code>cookies.txt</code>, set{" "}
                <code>YT_DLP_COOKIES_FILE=./cookies.txt</code> in <code>.env.local</code>, then redeploy.
              </div>
            )}
            <KeywordInput
              keywords={keywords}
              onKeywordsChange={setKeywords}
              maxResults={maxResults}
              onMaxResultsChange={setMaxResults}
              maxDurationSeconds={maxDurationSeconds}
              onMaxDurationSecondsChange={setMaxDurationSeconds}
              maxDurationOptions={MAX_DURATION_OPTIONS}
              quality={quality}
              onQualityChange={setQuality}
              regionCode={regionCode}
              onRegionCodeChange={setRegionCode}
              regionOptions={YOUTUBE_REGION_OPTIONS}
              isRunning={isRunning}
              onSearch={handleSearch}
              onDownloadSelected={handleDownloadSelected}
              onReset={handleReset}
              onStop={handleStop}
              phase={phase}
              activeCount={active}
              selectedCount={selectedKeys.size}
            />

            {phase === "searching" && (
              <div className="search-state">
                <div className="spinner" />
                <span>
                  Searching YouTube for {keywords.length} keyword{keywords.length > 1 ? "s" : ""}…
                </span>
                <span style={{ fontSize: 11, color: "var(--tx3)", fontFamily: "var(--m)" }}>
                  youtube.com/v3/search · region={regionCode}
                </span>
              </div>
            )}

            {showSelection && (
              <>
                <div className="vgrid-hdr">
                  <span className="vgrid-title">Pick videos to download</span>
                  <span className="vgrid-meta">
                    {selectedKeys.size} of {total} selected
                  </span>
                </div>
                <div className="select-toolbar">
                  <button
                    type="button"
                    className="select-btn"
                    onClick={() => setSelectedKeys(new Set(videos.map((v) => selectionKey(v))))}
                  >
                    Select all
                  </button>
                  <button type="button" className="select-btn" onClick={() => setSelectedKeys(new Set())}>
                    Clear selection
                  </button>
                </div>
                <VideoGrid
                  videos={videos}
                  selectable
                  selectedKeys={selectedKeys}
                  onToggle={toggleVideoSelection}
                />
              </>
            )}

            {showActiveRun && (
              <>
                <div className="vgrid-hdr">
                  <span className="vgrid-title">
                    {total} video{total > 1 ? "s" : ""} in pipeline
                  </span>
                  <span className="vgrid-meta">
                    {done} stored
                    {transcripts > 0 ? ` · ${transcripts} transcripts` : ""}
                    {failed > 0 ? ` · ${failed} failed` : ""}
                    {total - done - failed > 0 ? ` · ${total - done - failed} pending` : ""}
                  </span>
                </div>
                <VideoGrid videos={videos} />
                {showProgress && (
                  <ProgressSummary
                    phase={phase}
                    done={done}
                    total={total}
                    storedMb={storedMb}
                    failed={failed}
                  />
                )}
              </>
            )}

            {showHistory && (
              <div className="history-section">
                <div className="vgrid-hdr">
                  <span className="vgrid-title">Download history</span>
                  <span className="vgrid-meta">
                    {historyToShow.length} stored in R2
                  </span>
                </div>
                <VideoGrid
                  videos={historyToShow}
                  deletable
                  onDelete={handleDeleteVideo}
                  deletingKey={deletingKey}
                />
              </div>
            )}

            {phase === "input" && keywords.length === 0 && !showHistory && (
              <div className="empty-hint">
                Add keywords above, then click <strong>Search YouTube</strong>.
                <br />
                Review the results, pick the videos you want,
                <br />
                then download with transcripts to R2.
              </div>
            )}
          </div>

          <div className="vdiv" />

          <div className="right">
            <div className="r-title">Storage</div>
            <StorageOverview
              summary={summary}
              r2Storage={r2Storage}
              storageLoaded={storageLoaded}
              localStoredMb={
                isRunning ? storedMb : r2Storage ? r2Storage.totalBytes / (1024 * 1024) : 0
              }
              localFileCount={isRunning ? done : (r2Storage?.objectCount ?? summaryDownloaded)}
              r2Ok={health.r2 === "ok"}
            />
            <StatCards
              downloaded={isRunning ? done : summaryDownloaded}
              failed={isRunning ? failed : summaryFailed}
              successPct={
                isRunning
                  ? total > 0
                    ? Math.round((done / total) * 100)
                    : null
                  : summarySuccessPct
              }
            />
            <AllocationBars
              keywords={
                keywords.length > 0
                  ? keywords
                  : Array.from(new Set(historyVideos.map((v) => v.keyword)))
              }
              videos={isRunning ? videos : historyVideos}
              videoSummary={videoSummary}
            />
          </div>
        </div>
      </div>

      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete from R2?"
        message={
          deleteTarget
            ? `"${deleteTarget.title || deleteTarget.videoId}" will be permanently removed from R2, including the MP4 and transcript. This cannot be undone.`
            : ""
        }
        loading={Boolean(deletingKey)}
        onConfirm={confirmDeleteVideo}
        onCancel={() => {
          if (!deletingKey) setDeleteTarget(null);
        }}
      />

      <OnboardingModal open={showOnboarding} onComplete={completeOnboarding} />
    </main>
  );
}
