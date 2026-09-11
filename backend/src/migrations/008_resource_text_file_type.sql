-- 008_resource_text_file_type.sql
--
-- .md and .txt files were classified as 'document', the same bucket
-- as opaque binary formats (.doc/.docx/.rtf/.odt) that genuinely need
-- a real office viewer -- and the file viewer has no preview branch
-- for 'document' at all, so .md/.txt resources could never be opened
-- inline. This splits them into their own 'text' type, which the
-- viewer can render directly.

DO $$
DECLARE
    con_name text;
BEGIN
    SELECT con.conname INTO con_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'resources'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%file_type%';

    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE resources DROP CONSTRAINT %I', con_name);
    END IF;
END $$;

ALTER TABLE resources ADD CONSTRAINT resources_file_type_check
    CHECK (file_type IN ('image', 'video', 'audio', 'pdf', 'text', 'document', 'schematic_folder', 'youtube', 'other'));

-- Reclassify already-uploaded .md/.txt files so they pick up the new
-- inline preview without needing to be re-uploaded.
UPDATE resources
SET file_type = 'text'
WHERE file_type = 'document'
  AND (original_filename ILIKE '%.md' OR original_filename ILIKE '%.txt');
