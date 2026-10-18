-- Migration: 20261017_item_salvage_recovery.sql
-- B2 Quarantined salvage, condition inspection, reviewed valuation

CREATE TABLE IF NOT EXISTS item_salvage_recoveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    recovery_type TEXT NOT NULL CHECK (recovery_type IN ('unused_stock_return','equipment_return','component_recovery','disassembly_output','scrap')),
    recovered_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    recovered_item_name TEXT NOT NULL,
    source_quantity NUMERIC(12,3) NOT NULL CHECK (source_quantity > 0),
    recovered_quantity NUMERIC(12,3) NOT NULL CHECK (recovered_quantity > 0),
    unit TEXT,
    quarantine_status TEXT NOT NULL DEFAULT 'quarantined' CHECK (quarantine_status IN ('quarantined','inspected_approved','inspected_rejected','released')),
    condition TEXT NOT NULL DEFAULT 'uninspected' CHECK (condition IN ('uninspected','like_new','good','fair','damaged_repairable','scrap')),
    reviewed_valuation NUMERIC(12,2),
    valuation_notes TEXT,
    attestation_notes TEXT,
    quarantined_by UUID NOT NULL REFERENCES users(id),
    inspected_by UUID REFERENCES users(id),
    inspected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_salvage_source ON item_salvage_recoveries(source_item_id);
CREATE INDEX IF NOT EXISTS idx_item_salvage_project ON item_salvage_recoveries(project_id);
CREATE INDEX IF NOT EXISTS idx_item_salvage_status ON item_salvage_recoveries(quarantine_status);
