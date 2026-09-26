-- Add Planning without rewriting existing projects or changing their current status.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('planning','active','completed','on_hold','cancelled'));
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'planning';
