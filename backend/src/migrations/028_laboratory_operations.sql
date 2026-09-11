-- Track 4: laboratory operations foundation.
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  website TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(name);

ALTER TABLE items ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_items_supplier_id ON items(supplier_id);

CREATE TABLE IF NOT EXISTS project_resource_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  requirement_type TEXT NOT NULL DEFAULT 'component' CHECK (requirement_type IN ('component','equipment','tool','material','consumable','resource','other')),
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit TEXT,
  required_by DATE,
  preferred_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'required' CHECK (status IN ('required','available','allocated','ordered','fulfilled','cancelled')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resource_requirements_project ON project_resource_requirements(project_id, status, required_by);

CREATE OR REPLACE FUNCTION labos_track4_set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS suppliers_updated_at ON suppliers;
CREATE TRIGGER suppliers_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION labos_track4_set_updated_at();
DROP TRIGGER IF EXISTS project_resource_requirements_updated_at ON project_resource_requirements;
CREATE TRIGGER project_resource_requirements_updated_at BEFORE UPDATE ON project_resource_requirements FOR EACH ROW EXECUTE FUNCTION labos_track4_set_updated_at();
