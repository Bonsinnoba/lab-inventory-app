-- Scope sync tombstones to the owning project where applicable.
ALTER TABLE sync_tombstones
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sync_tombstones_project
  ON sync_tombstones(project_id,deleted_at DESC);
