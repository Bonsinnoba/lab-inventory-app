-- Deletion evidence must outlive its parent. Retain the UUID scope; SET NULL
-- would erase the historical authorization boundary for private projects.
DO $$
DECLARE constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT c.conname FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='project_id'
    WHERE c.conrelid='sync_tombstones'::regclass AND c.contype='f'
      AND c.confrelid='projects'::regclass AND c.conkey=ARRAY[a.attnum]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE sync_tombstones DROP CONSTRAINT %I',constraint_row.conname);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS sync_deleted_project_audience (
  project_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_sync_deleted_project_audience_user
  ON sync_deleted_project_audience(user_id,project_id);
-- Do not invent historical viewers or tombstones already lost to old cascades.
