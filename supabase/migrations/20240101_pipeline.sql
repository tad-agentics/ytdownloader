CREATE TABLE pipeline_jobs (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword           TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'queued'
                                CHECK (status IN (
                                  'queued','searching','downloading',
                                  'uploading','stopping','stopped','done','failed'
                                )),
  max_results       INT         NOT NULL DEFAULT 10,
  quality           TEXT        NOT NULL DEFAULT '720p',
  region_code       TEXT        NOT NULL DEFAULT 'VN',
  videos_found      INT         NOT NULL DEFAULT 0,
  videos_downloaded INT         NOT NULL DEFAULT 0,
  videos_failed     INT         NOT NULL DEFAULT 0,
  total_size_bytes  BIGINT      NOT NULL DEFAULT 0,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE TABLE pipeline_videos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID        NOT NULL REFERENCES pipeline_jobs(id) ON DELETE CASCADE,
  video_id         TEXT        NOT NULL,
  keyword          TEXT        NOT NULL,
  title            TEXT,
  channel          TEXT,
  view_count       BIGINT      NOT NULL DEFAULT 0,
  duration_seconds INT         NOT NULL DEFAULT 0,
  r2_key           TEXT,
  r2_public_url    TEXT,
  file_size_bytes  BIGINT      NOT NULL DEFAULT 0,
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN (
                                 'pending','downloading','uploading',
                                 'stored','failed','queued'
                               )),
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_status     ON pipeline_jobs(status);
CREATE INDEX idx_jobs_keyword    ON pipeline_jobs(keyword);
CREATE INDEX idx_jobs_created    ON pipeline_jobs(created_at DESC);
CREATE INDEX idx_videos_job      ON pipeline_videos(job_id);
CREATE INDEX idx_videos_keyword  ON pipeline_videos(keyword);
CREATE UNIQUE INDEX idx_videos_unique ON pipeline_videos(job_id, video_id);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON pipeline_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE VIEW pipeline_summary AS
SELECT
  COUNT(*)                                                       AS total_jobs,
  COUNT(*) FILTER (WHERE status = 'done')                       AS done_jobs,
  COUNT(*) FILTER (WHERE status IN ('stopped','failed'))        AS stopped_jobs,
  COUNT(*) FILTER (WHERE status NOT IN ('done','stopped','failed')) AS active_jobs,
  COALESCE(SUM(videos_downloaded), 0)                           AS total_videos,
  COALESCE(SUM(total_size_bytes),  0)                           AS total_bytes
FROM pipeline_jobs;

CREATE VIEW pipeline_video_summary AS
SELECT
  keyword,
  COUNT(*) FILTER (WHERE status = 'stored')  AS stored_count,
  COUNT(*) FILTER (WHERE status = 'failed')  AS failed_count,
  COUNT(*) FILTER (WHERE status = 'queued')  AS queued_count,
  COALESCE(SUM(file_size_bytes) FILTER (WHERE status = 'stored'), 0) AS stored_bytes
FROM pipeline_videos
GROUP BY keyword;
