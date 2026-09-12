-- Bandwidth-aware media acquisition for URL resources (yt-dlp backed).
ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS local_media_path TEXT,
  ADD COLUMN IF NOT EXISTS local_media_filename TEXT,
  ADD COLUMN IF NOT EXISTS local_media_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS local_media_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS local_media_downloaded_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS resource_download_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','scheduled','downloading','paused','completed','failed','cancelled')),
  quality TEXT NOT NULL DEFAULT '720p',
  scheduled_for TIMESTAMPTZ,
  priority INTEGER NOT NULL DEFAULT 0,
  progress NUMERIC(5,2) NOT NULL DEFAULT 0,
  bytes_downloaded BIGINT,
  total_bytes BIGINT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_resource_download_jobs_queue
  ON resource_download_jobs(status, priority DESC, scheduled_for, created_at);
CREATE INDEX IF NOT EXISTS idx_resource_download_jobs_resource
  ON resource_download_jobs(resource_id);

CREATE TABLE IF NOT EXISTS media_download_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  mode TEXT NOT NULL DEFAULT 'scheduled' CHECK (mode IN ('manual','scheduled','always')),
  window_start TIME NOT NULL DEFAULT '00:00',
  window_end TIME NOT NULL DEFAULT '06:00',
  concurrent_downloads INTEGER NOT NULL DEFAULT 1 CHECK (concurrent_downloads BETWEEN 1 AND 3),
  default_quality TEXT NOT NULL DEFAULT '720p',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO media_download_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
