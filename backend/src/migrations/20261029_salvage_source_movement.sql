-- Preserve historical consumption; recovery appends provenance and stock events.
ALTER TABLE item_salvage_recoveries ADD COLUMN IF NOT EXISTS source_movement_id UUID
 REFERENCES item_movements(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_salvage_source_movement ON item_salvage_recoveries(source_movement_id);
ALTER TABLE item_salvage_recoveries ADD COLUMN IF NOT EXISTS sync_version BIGINT NOT NULL DEFAULT 1;
CREATE OR REPLACE FUNCTION bump_salvage_sync_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.sync_version:=OLD.sync_version+1; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS salvage_sync_version ON item_salvage_recoveries;
CREATE TRIGGER salvage_sync_version BEFORE UPDATE ON item_salvage_recoveries FOR EACH ROW EXECUTE FUNCTION bump_salvage_sync_version();
