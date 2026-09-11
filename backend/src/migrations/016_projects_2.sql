-- LabOS v1.7: Projects 2.0 engineering workspace
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_due_date ON projects(due_date);
CREATE INDEX IF NOT EXISTS idx_projects_priority ON projects(priority);

CREATE TABLE IF NOT EXISTS project_members (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    member_role TEXT NOT NULL DEFAULT 'member' CHECK (member_role IN ('lead','member','observer')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id, project_id);

CREATE TABLE IF NOT EXISTS project_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','blocked','done','cancelled')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
    assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    due_date DATE,
    completed_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(project_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee ON project_tasks(assignee_id, status);

CREATE TABLE IF NOT EXISTS project_experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','completed','failed','cancelled')),
    hypothesis TEXT NOT NULL DEFAULT '',
    procedure TEXT NOT NULL DEFAULT '',
    observations TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL DEFAULT '',
    conclusion TEXT NOT NULL DEFAULT '',
    performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_experiments_project ON project_experiments(project_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_items (
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    allocated_quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (allocated_quantity >= 0),
    notes TEXT NOT NULL DEFAULT '',
    added_by UUID REFERENCES users(id) ON DELETE SET NULL,
    added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_project_items_item ON project_items(item_id, project_id);

-- Keep project timestamps current for direct edits made through the API.
CREATE OR REPLACE FUNCTION projects_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS projects_touch_updated_at_trigger ON projects;
CREATE TRIGGER projects_touch_updated_at_trigger
    BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION projects_touch_updated_at();

CREATE OR REPLACE FUNCTION project_tasks_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    IF NEW.status = 'done' AND OLD.status <> 'done' AND NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
    IF NEW.status <> 'done' THEN NEW.completed_at := NULL; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS project_tasks_touch_updated_at_trigger ON project_tasks;
CREATE TRIGGER project_tasks_touch_updated_at_trigger
    BEFORE UPDATE ON project_tasks FOR EACH ROW EXECUTE FUNCTION project_tasks_touch_updated_at();

CREATE OR REPLACE FUNCTION project_experiments_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    IF NEW.status = 'running' AND OLD.status <> 'running' AND NEW.started_at IS NULL THEN NEW.started_at := now(); END IF;
    IF NEW.status = 'completed' AND OLD.status <> 'completed' AND NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS project_experiments_touch_updated_at_trigger ON project_experiments;
CREATE TRIGGER project_experiments_touch_updated_at_trigger
    BEFORE UPDATE ON project_experiments FOR EACH ROW EXECUTE FUNCTION project_experiments_touch_updated_at();

-- Backfill owners from existing project creation order where possible is intentionally avoided;
-- legacy projects simply have no owner until an administrator assigns one in the workspace.
