-- Movement history should preserve the user-facing storage container names.
ALTER TABLE item_movements ADD COLUMN IF NOT EXISTS from_storage_location TEXT;
ALTER TABLE item_movements ADD COLUMN IF NOT EXISTS to_storage_location TEXT;

UPDATE item_movements m
SET from_storage_location = l.name
FROM locations l
WHERE m.from_location_id = l.id
  AND NULLIF(BTRIM(m.from_storage_location), '') IS NULL;

UPDATE item_movements m
SET to_storage_location = l.name
FROM locations l
WHERE m.to_location_id = l.id
  AND NULLIF(BTRIM(m.to_storage_location), '') IS NULL;
