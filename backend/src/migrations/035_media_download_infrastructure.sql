-- Media download infrastructure: cancellation, retry policy, diagnostics and durable worker state.
ALTER TABLE resource_download_jobs
  ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS process_started_at TIMESTAMPTZ;

ALTER TABLE resource_download_jobs
  DROP CONSTRAINT IF EXISTS resource_download_jobs_attempts_check;
ALTER TABLE resource_download_jobs
  ADD CONSTRAINT resource_download_jobs_attempts_check CHECK (attempts >= 0 AND attempts <= 20);
ALTER TABLE resource_download_jobs
  DROP CONSTRAINT IF EXISTS resource_download_jobs_max_attempts_check;
ALTER TABLE resource_download_jobs
  ADD CONSTRAINT resource_download_jobs_max_attempts_check CHECK (max_attempts BETWEEN 1 AND 5);

CREATE INDEX IF NOT EXISTS idx_resource_download_jobs_worker
  ON resource_download_jobs(status, cancel_requested, priority DESC, scheduled_for, created_at);

ALTER TABLE media_download_settings
  ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE media_download_settings
  DROP CONSTRAINT IF EXISTS media_download_settings_max_retries_check;
ALTER TABLE media_download_settings
  ADD CONSTRAINT media_download_settings_max_retries_check CHECK (max_retries BETWEEN 0 AND 4);

UPDATE resource_download_jobs
SET max_attempts = GREATEST(1, LEAST(5, COALESCE(max_attempts, 3))),
    cancel_requested = COALESCE(cancel_requested, FALSE)
WHERE TRUE;
