-- Migration: Item history (audit log) + maintenance reminders
-- Safe to re-run: every step checks before acting.

CREATE TABLE IF NOT EXISTS item_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_item_history_item ON item_history (item_id, changed_at DESC);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'items' AND column_name = 'next_maintenance_date'
    ) THEN
        ALTER TABLE items ADD COLUMN next_maintenance_date DATE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'items' AND column_name = 'maintenance_interval_days'
    ) THEN
        ALTER TABLE items ADD COLUMN maintenance_interval_days INT;
    END IF;
END $$;
