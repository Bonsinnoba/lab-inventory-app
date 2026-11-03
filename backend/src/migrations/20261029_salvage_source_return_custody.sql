ALTER TABLE item_salvage_recoveries ADD COLUMN IF NOT EXISTS source_custody_id UUID
 REFERENCES item_custody_records(id) ON DELETE RESTRICT;
ALTER TABLE item_salvage_recoveries ADD COLUMN IF NOT EXISTS custody_settlement_id UUID
 REFERENCES item_custody_settlements(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_salvage_source_custody ON item_salvage_recoveries(source_custody_id);
