-- Repair migration for installations where 017_sync_idempotency.sql
-- was already recorded before sync_tombstones was added to that file.
CREATE TABLE IF NOT EXISTS sync_tombstones (
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_tombstones_deleted_at
  ON sync_tombstones(deleted_at);
