"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import StepStrip, { type Phase } from "@/components/pipeline/StepStrip";
import KeywordInput from "@/components/pipeline/KeywordInput";
import VideoGrid, { type VideoState } from "@/components/pipeline/VideoGrid";
import ProgressSummary from "@/components/pipeline/ProgressSummary";
import StorageOverview from "@/components/storage/StorageOverview";
import StatCards from "@/components/storage/StatCards";
import AllocationBars from "@/components/storage/AllocationBars";
import type { PipelineJob, PipelineVideo } from "@/lib/pipeline/types";
import { YOUTUBE_REGION_OPTIONS } from "@/lib/pipeline/youtube-search";

const TERMINAL_JOB_STATUSES = ["done", "failed", "stopped"];

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
    transcriptStatus: v.transcript_status || "pending",
    transcriptLang: v.transcript_lang,
    transcriptUrl: v.transcript_public_url,
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
  const [quality, setQuality] = useState("720p");
  const [regionCode, setRegionCode] = useState("US");
  const [videos, setVideos] = useState<VideoState[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [videoSummary, setVideoSummary] = useState<
    Array<{ keyword: string; stored_count: number; failed_count: number; queued_count: number }>
  >([]);
  const [currentJobIds, setCurrentJobIds] = useState<string[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [health, setHealth] = useState<{
    youtubeApi?: "ok" | "unconfigured" | "error";
    r2?: "ok" | "unconfigured" | "error";
    supabase?: "ok" | "unconfigured" | "error";
  }>({});

  const runRef = useRef(false);
  const stopRef = useRef(false);
  const jobIdsRef = useRef<string[]>([]);
  const resultsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      if (resultsTimerRef.current) clearTimeout(resultsTimerRef.current);
    };
  }, []);

  const refreshStorage = useCallback(async () => {
    const res = await fetch("/api/pipeline/jobs?summary=1&r2=1");
    const data = await res.json();
    if (data.summary) setSummary(data.summary);
    if (data.videoSummary) setVideoSummary(data.videoSummary);
    if (data.r2) setHealth((h) => ({ ...h, r2: data.r2.ok ? "ok" : data.r2.configured === false ? "unconfigured" : "error" }));
  }, []);

  const scheduleResultsPhase = useCallback(() => {
    if (resultsTimerRef.current) return;
    setPhase("results");
    resultsTimerRef.current = setTimeout(() => {
      resultsTimerRef.current = null;
      if (!stopRef.current) setPhase("processing");
    }, 400);
  }, []);

  const pollJobs = useCallback(async (): Promise<boolean> => {
    const ids = jobIdsRef.current;
    if (!ids.length) return false;

    const results = await Promise.all(
      ids.map((id) => fetch(`/api/pipeline/jobs/${id}`).then((r) => r.json()))
    );

    const jobs: PipelineJob[] = results.map((r) => r.job).filter(Boolean);
    const incoming = results.flatMap((r) => (r.videos || []).map(mapDbVideo));

    setVideos((prev) => mergeVideos(prev, incoming));

    const currentPhase = phaseRef.current;
    if (
      incoming.length > 0 &&
      currentPhase === "searching" &&
      !stopRef.current &&
      !resultsTimerRef.current
    ) {
      scheduleResultsPhase();
    } else if (!resultsTimerRef.current || currentPhase !== "results") {
      setPhase(derivePhase(jobs, incoming.length, stopRef.current));
    }

    const allTerminal = jobs.length > 0 && jobs.every((j) => TERMINAL_JOB_STATUSES.includes(j.status));
    if (allTerminal) {
      runRef.current = false;
      if (stopRef.current) setPhase("stopped");
      await refreshStorage();
      return false;
    }

    return true;
  }, [refreshStorage, scheduleResultsPhase]);

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
    setPhase("input");
    if (resultsTimerRef.current) {
      clearTimeout(resultsTimerRef.current);
      resultsTimerRef.current = null;
    }
  };

  const handleRun = async () => {
    if (runRef.current || keywords.length === 0) return;
    runRef.current = true;
    stopRef.current = false;
    setVideos([]);
    jobIdsRef.current = [];
    setCurrentJobIds([]);
    setPhase("searching");
    setIsPolling(true);

    const res = await fetch("/api/pipeline/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords, maxResults, quality, regionCode }),
    });
    const data = await res.json();
    if (!res.ok) {
      runRef.current = false;
      setIsPolling(false);
      setPhase("input");
      return;
    }

    const ids = (data.jobs || []).map((j: { jobId: string }) => j.jobId);
    jobIdsRef.current = ids;
    setCurrentJobIds(ids);
  };

  const isRunning = ["searching", "processing", "results"].includes(phase);
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

  const showProgress =
    phase === "processing" || phase === "results" || phase === "done" || phase === "stopped";

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
            <KeywordInput
              keywords={keywords}
              onKeywordsChange={setKeywords}
              maxResults={maxResults}
              onMaxResultsChange={setMaxResults}
              quality={quality}
              onQualityChange={setQuality}
              regionCode={regionCode}
              onRegionCodeChange={setRegionCode}
              regionOptions={YOUTUBE_REGION_OPTIONS}
              isRunning={isRunning}
              onRun={handleRun}
              onReset={handleReset}
              onStop={handleStop}
              phase={phase}
              activeCount={active}
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

            {videos.length > 0 && (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 10,
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.3px" }}>
                    {total} video{total > 1 ? "s" : ""} found
                  </span>
                  <span style={{ fontSize: 11, color: "var(--tx3)", fontFamily: "var(--m)" }}>
                    {done} stored
                    {transcripts > 0 ? ` · ${transcripts} transcripts` : ""}
                    {failed > 0 ? ` · ${failed} failed` : ""}
                    {total - done - failed > 0 ? ` · ${total - done - failed} pending` : ""}
                  </span>
                </div>
                <VideoGrid videos={videos} />
                {showProgress && (
                  <ProgressSummary
                    phase={phase === "results" ? "processing" : phase}
                    done={done}
                    total={total}
                    storedMb={storedMb}
                    failed={failed}
                  />
                )}
              </>
            )}

            {phase === "input" && keywords.length === 0 && (
              <div className="empty-hint">
                Add keywords above, then click <strong>Run Pipeline</strong>.
                <br />
                YTDownloader will search YouTube, download each video,
                <br />
                fetch transcripts when available, and upload to R2.
              </div>
            )}
          </div>

          <div className="vdiv" />

          <div className="right">
            <div className="r-title">Storage</div>
            <StorageOverview
              summary={summary}
              localStoredMb={storedMb}
              localFileCount={done}
              r2Ok={health.r2 === "ok"}
            />
            <StatCards
              downloaded={done}
              failed={failed}
              successPct={total > 0 ? Math.round((done / total) * 100) : null}
            />
            <AllocationBars keywords={keywords} videos={videos} videoSummary={videoSummary} />
          </div>
        </div>
      </div>
    </main>
  );
}
