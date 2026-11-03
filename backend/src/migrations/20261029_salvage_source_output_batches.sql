-- One disassembly claims its source once, independently of its output count.
CREATE TABLE IF NOT EXISTS item_salvage_batches (
 id UUID PRIMARY KEY,
 source_item_id UUID REFERENCES items(id) ON DELETE RESTRICT,
 project_id UUID REFERENCES projects(id) ON DELETE RESTRICT,
 source_movement_id UUID REFERENCES item_movements(id) ON DELETE RESTRICT,
 source_quantity NUMERIC(12,3) NOT NULL CHECK(source_quantity>0),
 created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE item_salvage_recoveries ADD COLUMN IF NOT EXISTS batch_id UUID
 REFERENCES item_salvage_batches(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_salvage_recovery_batch ON item_salvage_recoveries(batch_id);
CREATE INDEX IF NOT EXISTS idx_salvage_batch_source ON item_salvage_batches(source_movement_id);
