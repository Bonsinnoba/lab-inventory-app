-- LabOS Phase 4: storage containers, free-form storage labels, and indexes for paginated scientific inventory views
CREATE TABLE IF NOT EXISTS storage_containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  container_type TEXT NOT NULL DEFAULT 'box',
  storage_location TEXT,
  capacity NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE items ADD COLUMN IF NOT EXISTS storage_location TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS storage_container_id UUID REFERENCES storage_containers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_items_storage_location ON items(storage_location);
CREATE INDEX IF NOT EXISTS idx_items_storage_container_id ON items(storage_container_id);
CREATE INDEX IF NOT EXISTS idx_items_location_id ON items(location_id);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_storage_containers_location ON storage_containers(storage_location);

CREATE OR REPLACE FUNCTION labos_storage_container_touch() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS storage_containers_updated_at ON storage_containers;
CREATE TRIGGER storage_containers_updated_at
BEFORE UPDATE ON storage_containers
FOR EACH ROW EXECUTE FUNCTION labos_storage_container_touch();
