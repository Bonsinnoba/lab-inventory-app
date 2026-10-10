-- Additive upgrade: retain all inventory and publish the new version to cursors.
ALTER TABLE items ADD COLUMN IF NOT EXISTS sync_version INTEGER;
UPDATE items SET sync_version=1,updated_at=clock_timestamp() WHERE sync_version IS NULL;
ALTER TABLE items ALTER COLUMN sync_version SET DEFAULT 1;
ALTER TABLE items ALTER COLUMN sync_version SET NOT NULL;
CREATE OR REPLACE FUNCTION labos_inventory_version() RETURNS trigger AS $$
BEGIN
  NEW.sync_version := OLD.sync_version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS zz_labos_inventory_version ON items;
CREATE TRIGGER zz_labos_inventory_version BEFORE UPDATE ON items
FOR EACH ROW EXECUTE FUNCTION labos_inventory_version();

CREATE OR REPLACE FUNCTION labos_inventory_deleted() RETURNS trigger AS $$
BEGIN
  INSERT INTO sync_tombstones(entity_type,entity_id) VALUES('item',OLD.id)
    ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=clock_timestamp();
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS labos_inventory_deleted ON items;
CREATE TRIGGER labos_inventory_deleted AFTER DELETE ON items
FOR EACH ROW EXECUTE FUNCTION labos_inventory_deleted();
