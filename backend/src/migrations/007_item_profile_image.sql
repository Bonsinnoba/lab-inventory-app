-- 007_item_profile_image.sql
--
-- The item's inventory-list picture was being *derived* — a subquery
-- on GET /items grabbed "whatever image resource was most recently
-- uploaded for this item," which meant any image someone attached as
-- a general resource (a datasheet cover, a screenshot, an Amazon
-- listing photo) could silently hijack the inventory thumbnail, and
-- the thumbnail itself showed up a second time in the item's
-- Resources list as an ordinary attachment.
--
-- This adds a real, explicit column: the item's picture is now a
-- distinct field the item points at directly, set only through the
-- dedicated "Add/Change picture" control (ItemPicture.tsx) — not
-- something inferred from whatever else happens to be attached.

ALTER TABLE items
    ADD COLUMN IF NOT EXISTS image_resource_id UUID REFERENCES resources(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_items_image_resource_id ON items (image_resource_id);

-- Backfill: for items that already have exactly one image-type resource
-- attached (the common case under the old auto-derived behavior), point
-- the new column at it so existing pictures don't just disappear. Items
-- with more than one attached image are left unset rather than guessed
-- at — someone can pick the right one via "Change picture."
UPDATE items i
SET image_resource_id = sub.id
FROM (
    SELECT r.item_id, r.id,
           ROW_NUMBER() OVER (PARTITION BY r.item_id ORDER BY r.created_at DESC) AS rn,
           COUNT(*) OVER (PARTITION BY r.item_id) AS image_count
    FROM resources r
    WHERE r.file_type = 'image' AND r.item_id IS NOT NULL
) sub
WHERE sub.item_id = i.id AND sub.rn = 1 AND sub.image_count = 1 AND i.image_resource_id IS NULL;
