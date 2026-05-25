import { createClient } from "@supabase/supabase-js";
import type { JobStatus, PipelineJob, PipelineVideo, VideoStatus } from "./types";

export type { JobStatus, PipelineJob, PipelineVideo, VideoStatus };

const db = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

export async function createJob(
  id: string,
  keyword: string,
  maxResults: number,
  quality: string,
  regionCode: string
) {
  const { error } = await db()
    .from("pipeline_jobs")
    .insert({ id, keyword, status: "queued", max_results: maxResults, quality, region_code: regionCode });
  if (error) throw new Error(`createJob: ${error.message}`);
}

export async function updateJob(id: string, patch: Record<string, unknown>) {
  const { error } = await db()
    .from("pipeline_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`updateJob: ${error.message}`);
}

export async function getJob(id: string): Promise<PipelineJob | null> {
  const { data, error } = await db().from("pipeline_jobs").select("*").eq("id", id).single();
  if (error) return null;
  return data as PipelineJob;
}

export async function listJobs(limit = 100): Promise<PipelineJob[]> {
  const { data, error } = await db()
    .from("pipeline_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listJobs: ${error.message}`);
  return (data || []) as PipelineJob[];
}

export async function recordVideo(video: {
  job_id: string;
  video_id: string;
  keyword: string;
  title: string;
  channel: string;
  view_count: number;
  duration_seconds: number;
  r2_key: string | null;
  r2_public_url: string | null;
  file_size_bytes: number;
  transcript_r2_key: string | null;
  transcript_public_url: string | null;
  transcript_lang: string | null;
  transcript_status: "pending" | "stored" | "missing" | "failed";
  status: VideoStatus;
  error: string | null;
}) {
  const { error } = await db().from("pipeline_videos").insert(video);
  if (error) throw new Error(`recordVideo: ${error.message}`);
}

export async function insertPendingVideos(
  jobId: string,
  keyword: string,
  videos: Array<{
    videoId: string;
    title: string;
    channelName: string;
    viewCount: number;
    durationSeconds: number;
  }>
) {
  if (!videos.length) return;
  const rows = videos.map((v) => ({
    job_id: jobId,
    video_id: v.videoId,
    keyword,
    title: v.title,
    channel: v.channelName,
    view_count: v.viewCount,
    duration_seconds: v.durationSeconds,
    r2_key: null,
    r2_public_url: null,
    file_size_bytes: 0,
    transcript_r2_key: null,
    transcript_public_url: null,
    transcript_lang: null,
    transcript_status: "pending" as const,
    status: "pending" as const,
    error: null,
  }));
  const { error } = await db().from("pipeline_videos").insert(rows);
  if (error) throw new Error(`insertPendingVideos: ${error.message}`);
}

export async function updateVideoStatus(
  jobId: string,
  videoId: string,
  patch: Partial<{
    status: VideoStatus;
    r2_key: string | null;
    r2_public_url: string | null;
    file_size_bytes: number;
    transcript_r2_key: string | null;
    transcript_public_url: string | null;
    transcript_lang: string | null;
    transcript_status: "pending" | "stored" | "missing" | "failed";
    error: string | null;
  }>
) {
  const { error } = await db()
    .from("pipeline_videos")
    .update(patch)
    .eq("job_id", jobId)
    .eq("video_id", videoId);
  if (error) throw new Error(`updateVideoStatus: ${error.message}`);
}

export async function resetInProgressVideos(jobId: string) {
  const { error } = await db()
    .from("pipeline_videos")
    .update({ status: "queued" })
    .eq("job_id", jobId)
    .in("status", ["downloading", "uploading"]);
  if (error) throw new Error(`resetInProgressVideos: ${error.message}`);
}

export async function listVideosByJob(jobId: string): Promise<PipelineVideo[]> {
  const { data, error } = await db()
    .from("pipeline_videos")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listVideosByJob: ${error.message}`);
  return (data || []) as PipelineVideo[];
}

export async function getVideo(jobId: string, videoId: string): Promise<PipelineVideo | null> {
  const { data, error } = await db()
    .from("pipeline_videos")
    .select("*")
    .eq("job_id", jobId)
    .eq("video_id", videoId)
    .single();
  if (error) return null;
  return data as PipelineVideo;
}

export async function deleteVideoRecord(jobId: string, videoId: string) {
  const { error } = await db()
    .from("pipeline_videos")
    .delete()
    .eq("job_id", jobId)
    .eq("video_id", videoId);
  if (error) throw new Error(`deleteVideoRecord: ${error.message}`);
}

export async function listStoredVideoIds(): Promise<Set<string>> {
  const { data, error } = await db()
    .from("pipeline_videos")
    .select("video_id")
    .eq("status", "stored");
  if (error) throw new Error(`listStoredVideoIds: ${error.message}`);
  return new Set((data || []).map((row) => row.video_id as string));
}

export async function listStoredVideos(limit = 50): Promise<PipelineVideo[]> {
  const { data, error } = await db()
    .from("pipeline_videos")
    .select("*")
    .eq("status", "stored")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listStoredVideos: ${error.message}`);
  return (data || []) as PipelineVideo[];
}

export async function getDashboardSummary() {
  const { data, error } = await db().from("pipeline_summary").select("*").single();
  if (error) throw new Error(`getDashboardSummary: ${error.message}`);
  return data;
}

export async function getVideoSummaryByKeyword() {
  const { data, error } = await db().from("pipeline_video_summary").select("*");
  if (error) throw new Error(`getVideoSummaryByKeyword: ${error.message}`);
  return data || [];
}
