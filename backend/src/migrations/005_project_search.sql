-- Migration: Add full-text search to projects
--
-- Projects were completely unsearchable via the global search endpoint --
-- no search_vector column existed on the projects table at all, and the
-- search route's default type list didn't include 'projects' either.
-- Safe to re-run: every step checks before acting.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'search_vector'
    ) THEN
        ALTER TABLE projects ADD COLUMN search_vector TSVECTOR;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_search ON projects USING GIN (search_vector);

CREATE OR REPLACE FUNCTION projects_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector := setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_search_vector_trigger ON projects;
CREATE TRIGGER projects_search_vector_trigger
    BEFORE INSERT OR UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION projects_search_vector_update();

-- Backfill existing rows -- the trigger above only fires on future
-- inserts/updates, so any project created before this migration would
-- otherwise have a NULL search_vector forever.
UPDATE projects SET search_vector = setweight(to_tsvector('english', coalesce(name, '')), 'A');
