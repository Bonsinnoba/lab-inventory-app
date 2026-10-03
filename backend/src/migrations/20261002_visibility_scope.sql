-- Visibility scope foundation. Existing data remains laboratory-visible so
-- this migration does not unexpectedly hide historical records.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_visibility_check'
  ) THEN
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'lab',
      ADD CONSTRAINT projects_visibility_check
        CHECK (visibility IN ('lab', 'project', 'restricted'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notes_visibility_check'
  ) THEN
    ALTER TABLE notes
      ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'lab',
      ADD CONSTRAINT notes_visibility_check
        CHECK (visibility IN ('lab', 'project', 'restricted'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'resources_visibility_check'
  ) THEN
    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'lab',
      ADD CONSTRAINT resources_visibility_check
        CHECK (visibility IN ('lab', 'project', 'restricted'));
  END IF;

  IF to_regclass('public.lab_findings') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lab_findings_visibility_check'
  ) THEN
    ALTER TABLE lab_findings
      ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'lab',
      ADD CONSTRAINT lab_findings_visibility_check
        CHECK (visibility IN ('lab', 'project', 'restricted'));
  END IF;

  IF to_regclass('public.lab_results') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lab_results_visibility_check'
  ) THEN
    ALTER TABLE lab_results
      ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'lab',
      ADD CONSTRAINT lab_results_visibility_check
        CHECK (visibility IN ('lab', 'project', 'restricted'));
  END IF;

  IF to_regclass('public.engineering_calculations') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'engineering_calculations_visibility_check'
  ) THEN
    ALTER TABLE engineering_calculations
      ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'lab',
      ADD CONSTRAINT engineering_calculations_visibility_check
        CHECK (visibility IN ('lab', 'project', 'restricted'));
  END IF;

  IF to_regclass('public.engineering_tests') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'engineering_tests_visibility_check'
  ) THEN
    ALTER TABLE engineering_tests
      ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'lab',
      ADD CONSTRAINT engineering_tests_visibility_check
        CHECK (visibility IN ('lab', 'project', 'restricted'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS record_access_grants (
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL CHECK (access_level IN ('view', 'edit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (entity_type, entity_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_record_access_grants_user
  ON record_access_grants (user_id, entity_type, entity_id);
