-- Additive; existing projects and pending intentions are preserved.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plan_revision BIGINT NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION bump_project_plan_revision() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW)-'updated_at'-'plan_revision') IS DISTINCT FROM
     (to_jsonb(OLD)-'updated_at'-'plan_revision') THEN
    NEW.plan_revision := OLD.plan_revision + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS project_plan_revision ON projects;
CREATE TRIGGER project_plan_revision BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION bump_project_plan_revision();

-- Every child write takes the same parent row lock as review decisions. This
-- serializes plan editing and approval even through older HTTP/native writers.
CREATE OR REPLACE FUNCTION touch_project_plan_from_child() RETURNS trigger AS $$
DECLARE
  old_row jsonb; new_row jsonb; old_project uuid; new_project uuid; target uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND (old_row-'updated_at')=(new_row-'updated_at') THEN RETURN NEW; END IF;
  old_project := (old_row->>'project_id')::uuid;
  new_project := (new_row->>'project_id')::uuid;
  IF old_project IS NULL AND old_row->>'experiment_id' IS NOT NULL THEN
    SELECT project_id INTO old_project FROM project_experiments WHERE id=(old_row->>'experiment_id')::uuid;
  END IF;
  IF new_project IS NULL AND new_row->>'experiment_id' IS NOT NULL THEN
    SELECT project_id INTO new_project FROM project_experiments WHERE id=(new_row->>'experiment_id')::uuid;
  END IF;
  IF old_project IS NULL AND old_row->>'task_id' IS NOT NULL THEN
    SELECT project_id INTO old_project FROM project_tasks WHERE id=(old_row->>'task_id')::uuid;
  END IF;
  IF new_project IS NULL AND new_row->>'task_id' IS NOT NULL THEN
    SELECT project_id INTO new_project FROM project_tasks WHERE id=(new_row->>'task_id')::uuid;
  END IF;
  FOR target IN SELECT DISTINCT x FROM unnest(ARRAY[old_project,new_project]) x WHERE x IS NOT NULL ORDER BY x LOOP
    UPDATE projects SET plan_revision=plan_revision+1 WHERE id=target;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['project_tasks','project_experiments','project_bom_items',
    'project_blocks','project_connectors','project_resource_requirements','project_items',
    'project_task_experiments','project_work_attachments','project_experiment_measurements',
    'project_experiment_observations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS project_plan_touch ON %I',relation);
    EXECUTE format('CREATE TRIGGER project_plan_touch AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION touch_project_plan_from_child()',relation);
  END LOOP;
END;
$$;
