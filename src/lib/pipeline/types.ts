export type JobStatus =
  | "queued"
  | "searching"
  | "downloading"
  | "uploading"
  | "stopping"
  | "stopped"
  | "done"
  | "failed";

export type VideoStatus =
  | "pending"
  | "downloading"
  | "uploading"
  | "stored"
  | "failed"
  | "queued";

export interface PipelineJob {
  id: string;
  keyword: string;
  status: JobStatus;
  max_results: number;
  quality: string;
  region_code: string;
  videos_found: number;
  videos_downloaded: number;
  videos_failed: number;
  total_size_bytes: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface PipelineVideo {
  id: string;
  job_id: string;
  video_id: string;
  keyword: string;
  title: string | null;
  channel: string | null;
  view_count: number;
  duration_seconds: number;
  r2_key: string | null;
  r2_public_url: string | null;
  file_size_bytes: number;
  status: VideoStatus;
  error: string | null;
  created_at: string;
}
