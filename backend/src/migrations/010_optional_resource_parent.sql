-- Migration: allow unattached resources
--
-- resources_exactly_one_parent previously required a resource to have
-- exactly one of item_id/project_id/note_id/parent_resource_id set --
-- there was no way to upload a file or add a link without attaching it
-- to something. This relaxes it to "at most one": a resource may now
-- have zero parents (a general, unattached resource in the shared
-- library) or exactly one, but still never more than one.

ALTER TABLE resources DROP CONSTRAINT IF EXISTS resources_exactly_one_parent;

ALTER TABLE resources ADD CONSTRAINT resources_at_most_one_parent CHECK (
    (CASE WHEN item_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN project_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN note_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN parent_resource_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
);
