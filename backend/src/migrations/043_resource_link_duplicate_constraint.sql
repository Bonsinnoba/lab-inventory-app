-- Add partial unique index to prevent duplicate link resources
-- This ensures that link resources with the same URL cannot be created
-- in the same parent context (item_id, project_id, note_id, or parent_resource_id)
-- The index is partial (WHERE kind = 'link') to only apply to link resources
-- NULL values are allowed for parent fields (unattached resources)

-- First, handle any existing duplicates by keeping the most recently created one
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
    ) as rn
  FROM resources
  WHERE kind = 'link' AND url IS NOT NULL
)
DELETE FROM resources
WHERE id IN (SELECT id FROM duplicates WHERE rn > 1);

-- Create the partial unique index
CREATE UNIQUE INDEX idx_resources_link_unique
ON resources (lower(btrim(url)), item_id, project_id, note_id, parent_resource_id)
WHERE kind = 'link' AND url IS NOT NULL;
