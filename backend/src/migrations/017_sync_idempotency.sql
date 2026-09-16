CREATE TABLE IF NOT EXISTS sync_idempotency (
  change_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  operation TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  response_json JSONB NOT NULL,
  response_status INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sync_idempotency_device_created ON sync_idempotency(device_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_tombstones (
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_sync_tombstones_deleted_at ON sync_tombstones(deleted_at);

ALTER TABLE item_movements ADD COLUMN IF NOT EXISTS from_storage_location TEXT;
ALTER TABLE item_movements ADD COLUMN IF NOT EXISTS to_storage_location TEXT;
ALTER TABLE item_movements DROP CONSTRAINT IF EXISTS item_movements_location_check;
ALTER TABLE item_movements ADD CONSTRAINT item_movements_location_check
  CHECK (movement_type <> 'transfer' OR to_location_id IS NOT NULL OR NULLIF(BTRIM(to_storage_location), '') IS NOT NULL);
