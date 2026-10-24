-- Preserve all existing projects. Lifecycle revision is separate from work edits.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lifecycle_revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('planning','active','completed','on_hold','cancelled','archived'));
CREATE OR REPLACE FUNCTION bump_project_lifecycle_revision() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.lifecycle_revision := OLD.lifecycle_revision + 1;
  ELSE
    NEW.lifecycle_revision := OLD.lifecycle_revision;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS project_lifecycle_revision ON projects;
CREATE TRIGGER project_lifecycle_revision BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION bump_project_lifecycle_revision();
