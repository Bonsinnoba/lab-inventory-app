-- LabOS resource editing/version lineage.
-- Derived files are independent resources so the original remains immutable.
ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS derived_from_resource_id UUID REFERENCES resources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_resources_derived_from
  ON resources(derived_from_resource_id);
