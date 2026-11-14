-- Preserve unknown legacy provenance; never guess that an existing URL-like
-- title was not explicitly supplied by its author.
ALTER TABLE resources ADD COLUMN IF NOT EXISTS name_source TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS title_lookup_after TIMESTAMPTZ;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS title_lookup_attempts INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='resources_name_source_check' AND conrelid='resources'::regclass) THEN
  ALTER TABLE resources ADD CONSTRAINT resources_name_source_check CHECK(name_source IS NULL OR name_source IN ('user','url_fallback','metadata'));
 END IF;
END $$;
