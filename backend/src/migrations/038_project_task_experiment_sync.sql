-- LabOS sync: give task/experiment links a stable UUID identity and project scope.
-- Existing installations created this table in 026_lab_work_reproducibility.sql
-- with a composite primary key, so this migration upgrades that shape safely.

ALTER TABLE project_task_experiments
  ADD COLUMN IF NOT EXISTS id UUID;

UPDATE project_task_experiments
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE project_task_experiments
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE project_task_experiments
  ADD COLUMN IF NOT EXISTS project_id UUID;

UPDATE project_task_experiments te
SET project_id = p.project_id
FROM project_tasks p
WHERE p.id = te.task_id
  AND te.project_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM project_task_experiments te
    LEFT JOIN project_tasks t ON t.id = te.task_id
    LEFT JOIN project_experiments e ON e.id = te.experiment_id
    WHERE te.project_id IS NULL
       OR t.project_id IS NULL
       OR e.project_id IS NULL
       OR t.project_id <> e.project_id
       OR te.project_id <> t.project_id
  ) THEN
    RAISE EXCEPTION 'Cannot scope project_task_experiments: task and experiment project ownership is inconsistent';
  END IF;
END $$;

ALTER TABLE project_task_experiments
  ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE project_task_experiments
  ADD CONSTRAINT project_task_experiments_project_fk
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE project_task_experiments
  DROP CONSTRAINT IF EXISTS project_task_experiments_pkey;

ALTER TABLE project_task_experiments
  ADD CONSTRAINT project_task_experiments_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_task_experiments_task_experiment
  ON project_task_experiments(task_id, experiment_id);

CREATE INDEX IF NOT EXISTS idx_project_task_experiments_project
  ON project_task_experiments(project_id, created_at DESC);
