-- LabOS inventory locations are user-defined labels, not a fixed hierarchy.
-- Preserve legacy structured locations by copying their names into the
-- free-form storage_location field before the UI stops creating new links.
UPDATE items i
SET storage_location = NULLIF(BTRIM(l.name), '')
FROM locations l
WHERE i.location_id = l.id
  AND NULLIF(BTRIM(i.storage_location), '') IS NULL;

-- New inventory records no longer need a structured location relationship.
-- Keep the legacy columns/tables intact for compatibility with historical
-- movement records and older installations.
