-- Control revisions intentionally exclude worker progress and state changes.
ALTER TABLE resource_download_jobs ADD COLUMN IF NOT EXISTS control_version INTEGER NOT NULL DEFAULT 0;
