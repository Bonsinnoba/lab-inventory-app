-- Damaged custody returns stay in recovery quarantine until fresh inspection.
ALTER TABLE item_salvage_recoveries
 ADD COLUMN IF NOT EXISTS repair_received_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS repair_completed_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS repair_verification_notes TEXT;
