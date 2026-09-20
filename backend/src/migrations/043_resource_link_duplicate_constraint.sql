-- Resource link identity is the normalized URL plus exactly one parent scope.
-- PostgreSQL NULLs are otherwise considered distinct by UNIQUE indexes, so
-- NULLS NOT DISTINCT is required: an item-scoped link, for example, has NULL
-- project/note/parent_resource_id values that must still participate in the
-- uniqueness key. PostgreSQL 15+ is required (the test environment uses 16).

-- First, remove pre-existing logical duplicates while preserving the newest row.
-- PARTITION BY treats NULLs as equal, matching the intended logical identity.
WITH duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        lower(btrim(url)),
        item_id,
        project_id,
        note_id,
        parent_resource_id
      ORDER BY created_at DESC
    ) AS rn
  FROM resources
  WHERE kind = 'link' AND url IS NOT NULL
)
DELETE FROM resources
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- Database-level guarantee for all link resources, including rows whose
-- non-applicable parent columns are NULL.
CREATE UNIQUE INDEX idx_resources_link_unique
ON resources (lower(btrim(url)), item_id, project_id, note_id, parent_resource_id)
NULLS NOT DISTINCT
WHERE kind = 'link' AND url IS NOT NULL;
