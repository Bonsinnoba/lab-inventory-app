-- Additive fence: old rows remain recoverable; no jobs/files are removed.
ALTER TABLE resource_download_jobs ADD COLUMN IF NOT EXISTS worker_run_id UUID;

-- Keep deletion identity after the queue row is removed. Scope remains attached
-- to its resource; snapshots reveal only tombstones the current user may read.
CREATE TABLE IF NOT EXISTS download_job_tombstones (
  job_id UUID PRIMARY KEY,
  resource_id UUID NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_download_job_tombstones_resource ON download_job_tombstones(resource_id);

-- Recover historical deletion identity only from committed server receipts.
-- Never infer deletion from absence alone or hide a currently existing job.
INSERT INTO download_job_tombstones(job_id,resource_id,deleted_at)
SELECT (response_json->>'id')::uuid,(response_json->>'resource_id')::uuid,created_at
FROM sync_idempotency receipt
WHERE entity_type='resource_download_job' AND operation='delete'
  AND response_json->>'deleted'='true'
  AND response_json->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND response_json->>'resource_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND NOT EXISTS(SELECT 1 FROM resource_download_jobs job WHERE job.id::text=lower(receipt.response_json->>'id'))
ON CONFLICT(job_id) DO NOTHING;
