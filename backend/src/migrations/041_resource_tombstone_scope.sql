-- Preserve resource ownership context in deletion tombstones so scoped resources
-- cannot leak deletion metadata to unrelated users/installations.
ALTER TABLE sync_tombstones
  ADD COLUMN IF NOT EXISTS item_id UUID,
  ADD COLUMN IF NOT EXISTS note_id UUID;

CREATE INDEX IF NOT EXISTS idx_sync_tombstones_resource_scope
  ON sync_tombstones(entity_type, project_id, item_id, note_id, deleted_at DESC)
  WHERE entity_type = 'resource';
