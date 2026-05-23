ALTER TABLE pipeline_videos
  ADD COLUMN IF NOT EXISTS transcript_r2_key TEXT,
  ADD COLUMN IF NOT EXISTS transcript_public_url TEXT,
  ADD COLUMN IF NOT EXISTS transcript_lang TEXT,
  ADD COLUMN IF NOT EXISTS transcript_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (transcript_status IN ('pending', 'stored', 'missing', 'failed'));

DROP VIEW IF EXISTS pipeline_video_summary;

CREATE VIEW pipeline_video_summary AS
SELECT
  keyword,
  COUNT(*) FILTER (WHERE status = 'stored') AS stored_count,
  COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
  COUNT(*) FILTER (WHERE status = 'queued') AS queued_count,
  COUNT(*) FILTER (WHERE transcript_status = 'stored') AS transcript_count,
  COALESCE(SUM(file_size_bytes) FILTER (WHERE status = 'stored'), 0) AS stored_bytes
FROM pipeline_videos
GROUP BY keyword;
