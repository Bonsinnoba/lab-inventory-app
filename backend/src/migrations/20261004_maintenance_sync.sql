-- Existing maintenance rows keep their identity and history. Every writer,
-- including legacy HTTP routes, advances the version used by offline clients.
ALTER TABLE maintenance_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE maintenance_records ADD COLUMN IF NOT EXISTS sync_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE maintenance_records ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION version_maintenance_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  NEW.sync_version := OLD.sync_version + 1;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS maintenance_sync_version ON maintenance_records;
CREATE TRIGGER maintenance_sync_version BEFORE UPDATE ON maintenance_records
FOR EACH ROW EXECUTE FUNCTION version_maintenance_record();

CREATE OR REPLACE FUNCTION tombstone_maintenance_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sync_tombstones(entity_type,entity_id) VALUES('maintenance_record',OLD.id)
  ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now();
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS maintenance_sync_delete ON maintenance_records;
CREATE TRIGGER maintenance_sync_delete AFTER DELETE ON maintenance_records
FOR EACH ROW EXECUTE FUNCTION tombstone_maintenance_record();
