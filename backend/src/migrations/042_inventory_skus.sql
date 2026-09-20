-- Give existing inventory records without a SKU a stable LabOS-generated SKU.
-- The UUID-derived suffix keeps generation deterministic per existing row and
-- makes collisions practically impossible while remaining human-readable.
UPDATE items
SET sku =
  'LAB-' ||
  COALESCE(NULLIF(left(regexp_replace(upper(coalesce(name, 'ITEM')), '[^A-Z0-9]+', '', 'g'), 8), ''), 'ITEM') ||
  '-' ||
  COALESCE(NULLIF(left(regexp_replace(upper(coalesce(type, 'ITEM')), '[^A-Z0-9]+', '', 'g'), 6), ''), 'ITEM') ||
  '-' ||
  upper(left(md5(id::text), 6))
WHERE sku IS NULL OR btrim(sku) = '';
