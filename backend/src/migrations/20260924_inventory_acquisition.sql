-- Preserve how laboratory inventory was obtained independently of its replacement value.
ALTER TABLE items ADD COLUMN IF NOT EXISTS acquisition_method TEXT NOT NULL DEFAULT 'unspecified';
ALTER TABLE items ADD COLUMN IF NOT EXISTS acquisition_source TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS acquisition_notes TEXT;
ALTER TABLE items ADD CONSTRAINT items_acquisition_method_check CHECK (acquisition_method IN ('unspecified','purchased','salvaged','donated','transferred','fabricated','other'));
