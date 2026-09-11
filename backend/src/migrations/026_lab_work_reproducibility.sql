-- LabOS Track 2: Tasks, Experiments, Measurements, History & Reproducibility

CREATE TABLE IF NOT EXISTS project_task_experiments (
    task_id UUID NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
    experiment_id UUID NOT NULL REFERENCES project_experiments(id) ON DELETE CASCADE,
    relationship TEXT NOT NULL DEFAULT 'related' CHECK (relationship IN ('related','drives','validates','blocked_by')),
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, experiment_id)
);
CREATE INDEX IF NOT EXISTS idx_task_experiments_experiment ON project_task_experiments(experiment_id, task_id);

CREATE TABLE IF NOT EXISTS project_experiment_measurements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES project_experiments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    value_numeric NUMERIC,
    value_text TEXT,
    unit TEXT NOT NULL DEFAULT '',
    uncertainty NUMERIC,
    observed_at TIMESTAMPTZ,
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (value_numeric IS NOT NULL OR value_text IS NOT NULL),
    CHECK (uncertainty IS NULL OR uncertainty >= 0)
);
CREATE INDEX IF NOT EXISTS idx_experiment_measurements_experiment ON project_experiment_measurements(experiment_id, observed_at, created_at);

CREATE TABLE IF NOT EXISTS project_experiment_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES project_experiments(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'observation',
    content TEXT NOT NULL,
    observed_at TIMESTAMPTZ,
    recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_experiment_observations_experiment ON project_experiment_observations(experiment_id, observed_at, created_at);

CREATE TABLE IF NOT EXISTS project_work_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES project_tasks(id) ON DELETE CASCADE,
    experiment_id UUID REFERENCES project_experiments(id) ON DELETE CASCADE,
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((task_id IS NOT NULL) <> (experiment_id IS NOT NULL)),
    UNIQUE (task_id, resource_id),
    UNIQUE (experiment_id, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_work_attachments_task ON project_work_attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_work_attachments_experiment ON project_work_attachments(experiment_id);

CREATE TABLE IF NOT EXISTS project_experiment_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES project_experiments(id) ON DELETE CASCADE,
    revision_no INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('UPDATE','DELETE')),
    old_value JSONB NOT NULL,
    new_value JSONB,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (experiment_id, revision_no)
);
CREATE INDEX IF NOT EXISTS idx_experiment_revisions_experiment ON project_experiment_revisions(experiment_id, revision_no DESC);

CREATE OR REPLACE FUNCTION project_experiment_revision_trigger() RETURNS trigger AS $$
DECLARE next_revision INTEGER;
BEGIN
    SELECT COALESCE(MAX(revision_no),0)+1 INTO next_revision FROM project_experiment_revisions WHERE experiment_id=OLD.id;
    INSERT INTO project_experiment_revisions(experiment_id,revision_no,action,old_value,new_value)
    VALUES(OLD.id,next_revision,'UPDATE',to_jsonb(OLD),to_jsonb(NEW));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS project_experiment_revision_trigger ON project_experiments;
CREATE TRIGGER project_experiment_revision_trigger
    AFTER UPDATE ON project_experiments
    FOR EACH ROW EXECUTE FUNCTION project_experiment_revision_trigger();

CREATE OR REPLACE FUNCTION project_work_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at:=now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS project_experiment_measurements_updated_at ON project_experiment_measurements;
CREATE TRIGGER project_experiment_measurements_updated_at BEFORE UPDATE ON project_experiment_measurements FOR EACH ROW EXECUTE FUNCTION project_work_updated_at();
DROP TRIGGER IF EXISTS project_experiment_observations_updated_at ON project_experiment_observations;
CREATE TRIGGER project_experiment_observations_updated_at BEFORE UPDATE ON project_experiment_observations FOR EACH ROW EXECUTE FUNCTION project_work_updated_at();
