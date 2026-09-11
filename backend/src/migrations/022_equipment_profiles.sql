-- Add equipment and calibration profile fields to the unified inventory item model.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS manufacturer TEXT,
  ADD COLUMN IF NOT EXISTS model_number TEXT,
  ADD COLUMN IF NOT EXISTS serial_number TEXT,
  ADD COLUMN IF NOT EXISTS asset_tag TEXT,
  ADD COLUMN IF NOT EXISTS calibration_interval_days INTEGER,
  ADD COLUMN IF NOT EXISTS next_calibration_date DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_serial_number_unique
  ON items (serial_number) WHERE serial_number IS NOT NULL AND serial_number <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_asset_tag_unique
  ON items (asset_tag) WHERE asset_tag IS NOT NULL AND asset_tag <> '';
CREATE INDEX IF NOT EXISTS idx_items_calibration_due ON items (next_calibration_date);
