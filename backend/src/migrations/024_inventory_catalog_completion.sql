-- Complete the laboratory inventory catalog types and supplier identifiers.
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_type_check;
ALTER TABLE items ADD CONSTRAINT items_type_check
  CHECK (type IN ('tool', 'component', 'equipment', 'material', 'chemical', 'consumable', 'instrument', 'spare_part'));

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS supplier TEXT,
  ADD COLUMN IF NOT EXISTS part_number TEXT;

CREATE INDEX IF NOT EXISTS idx_items_supplier ON items (supplier);
CREATE INDEX IF NOT EXISTS idx_items_part_number ON items (part_number);
