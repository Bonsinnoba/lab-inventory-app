-- LabOS v1.5: shared knowledge metadata, revisions and discovery

ALTER TABLE resources ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_resources_category ON resources (category);
CREATE INDEX IF NOT EXISTS idx_resources_tags ON resources USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_resources_updated_at ON resources (updated_at DESC);

DROP TRIGGER IF EXISTS resources_search_vector_trigger ON resources;
DROP FUNCTION IF EXISTS resources_search_vector_update();
CREATE FUNCTION resources_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.category, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B');
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER resources_search_vector_trigger
    BEFORE INSERT OR UPDATE ON resources
    FOR EACH ROW EXECUTE FUNCTION resources_search_vector_update();

CREATE TABLE IF NOT EXISTS note_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    edited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_note_revisions_note ON note_revisions (note_id, created_at DESC);

CREATE TABLE IF NOT EXISTS resource_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL,
    original_filename TEXT,
    mime_type TEXT,
    size_bytes BIGINT,
    version_number INTEGER NOT NULL,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(resource_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_resource_versions_resource ON resource_versions (resource_id, version_number DESC);

DROP TRIGGER IF EXISTS notes_search_vector_trigger ON notes;
DROP FUNCTION IF EXISTS notes_search_vector_update();
CREATE FUNCTION notes_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.body, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B');
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER notes_search_vector_trigger
    BEFORE INSERT OR UPDATE ON notes
    FOR EACH ROW EXECUTE FUNCTION notes_search_vector_update();

UPDATE resources SET name = name;
UPDATE notes SET title = title;
