-- Device-aware audit trail for central identity and universal installations.
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS device_id TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_log_device_created
  ON audit_log (device_id, created_at DESC);
