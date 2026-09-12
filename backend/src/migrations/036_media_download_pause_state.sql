ALTER TABLE resource_download_jobs
  ADD COLUMN IF NOT EXISTS stop_requested_status TEXT;

ALTER TABLE resource_download_jobs
  DROP CONSTRAINT IF EXISTS resource_download_jobs_stop_requested_status_check;
ALTER TABLE resource_download_jobs
  ADD CONSTRAINT resource_download_jobs_stop_requested_status_check
  CHECK (stop_requested_status IS NULL OR stop_requested_status IN ('paused','cancelled'));

CREATE INDEX IF NOT EXISTS idx_resource_download_jobs_stop_request
  ON resource_download_jobs(status, stop_requested_status);
