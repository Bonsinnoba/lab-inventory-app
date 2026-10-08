ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS sync_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE storage_containers ADD COLUMN IF NOT EXISTS sync_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE storage_containers ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION labos_catalog_version() RETURNS trigger AS $$
BEGIN
  NEW.sync_version := OLD.sync_version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS catalog_version ON suppliers;
CREATE TRIGGER catalog_version BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION labos_catalog_version();
DROP TRIGGER IF EXISTS catalog_version ON storage_containers;
CREATE TRIGGER catalog_version BEFORE UPDATE ON storage_containers FOR EACH ROW EXECUTE FUNCTION labos_catalog_version();

CREATE OR REPLACE FUNCTION labos_catalog_deleted() RETURNS trigger AS $$
BEGIN
  INSERT INTO sync_tombstones(entity_type,entity_id) VALUES(TG_ARGV[0],OLD.id)
    ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=clock_timestamp();
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS catalog_deleted ON suppliers;
CREATE TRIGGER catalog_deleted AFTER DELETE ON suppliers FOR EACH ROW EXECUTE FUNCTION labos_catalog_deleted('supplier');
DROP TRIGGER IF EXISTS catalog_deleted ON storage_containers;
CREATE TRIGGER catalog_deleted AFTER DELETE ON storage_containers FOR EACH ROW EXECUTE FUNCTION labos_catalog_deleted('storage_container');
