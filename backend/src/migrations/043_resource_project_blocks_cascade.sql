-- Repair the resource -> project_blocks relationship for existing databases.
-- Project blocks are resource-backed canvas components. A non-text block
-- cannot survive without its resource because block_content_matches_type
-- requires resource_id to remain non-null. The original SET NULL action
-- therefore makes resource deletion fail with that check constraint.
ALTER TABLE project_blocks
  DROP CONSTRAINT IF EXISTS project_blocks_resource_id_fkey;

ALTER TABLE project_blocks
  ADD CONSTRAINT project_blocks_resource_id_fkey
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE;
