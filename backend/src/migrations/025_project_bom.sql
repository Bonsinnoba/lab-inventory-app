-- Persistent engineering BOM lines for project component planning.
CREATE TABLE IF NOT EXISTS project_bom_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  part_number TEXT,
  required_quantity NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (required_quantity > 0),
  unit TEXT,
  preferred_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  alternative_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_bom_project ON project_bom_items(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_project_bom_part_number ON project_bom_items(part_number);
