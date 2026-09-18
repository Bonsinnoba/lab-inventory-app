-- Give project task/experiment links a stable sync identity and project scope.
ALTER TABLE project_task_experiments
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE project_task_experiments
  ADD COLUMN IF NOT EXISTS project_id UUID;

UPDATE project_task_experiments te
SET project_id = t.project_id
FROM project_tasks t
WHERE t.id = te.task_id
  AND te.project_id IS NULL;

ALTER TABLE project_task_experiments
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN project_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='project_task_experiments_project_fk'
  ) THEN
    ALTER TABLE project_task_experiments
      ADD CONSTRAINT project_task_experiments_project_fk
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_task_experiments_id
  ON project_task_experiments(id);
CREATE INDEX IF NOT EXISTS idx_project_task_experiments_project
  ON project_task_experiments(project_id);
