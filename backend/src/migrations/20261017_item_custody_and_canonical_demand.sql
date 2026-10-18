-- Migration: 20261017_item_custody_and_canonical_demand.sql
-- B1 Quantity-aware custody ledger and B3 canonical demand references.

-- 1. Canonical requirement linkage on work items and BOM
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS requirement_id UUID REFERENCES project_resource_requirements(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_project_tasks_requirement ON project_tasks(requirement_id);

ALTER TABLE project_experiments ADD COLUMN IF NOT EXISTS requirement_id UUID REFERENCES project_resource_requirements(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_project_experiments_requirement ON project_experiments(requirement_id);

ALTER TABLE project_bom_items ADD COLUMN IF NOT EXISTS requirement_id UUID REFERENCES project_resource_requirements(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_project_bom_items_requirement ON project_bom_items(requirement_id);

-- 2. Item custody records: physical custody distinct from administrative responsibility
CREATE TABLE IF NOT EXISTS item_custody_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    source_movement_id UUID REFERENCES item_movements(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    task_id UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
    experiment_id UUID REFERENCES project_experiments(id) ON DELETE SET NULL,
    requirement_id UUID REFERENCES project_resource_requirements(id) ON DELETE SET NULL,
    reservation_id UUID REFERENCES project_reservations(id) ON DELETE SET NULL,
    recipient_id UUID NOT NULL REFERENCES users(id),
    issued_by UUID NOT NULL REFERENCES users(id),
    initial_quantity NUMERIC(12,3) NOT NULL CHECK (initial_quantity > 0),
    outstanding_quantity NUMERIC(12,3) NOT NULL CHECK (outstanding_quantity >= 0),
    unit TEXT,
    serial_number TEXT,
    status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','partially_settled','settled')),
    notes TEXT,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_custody_item ON item_custody_records(item_id, status);
CREATE INDEX IF NOT EXISTS idx_item_custody_recipient ON item_custody_records(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_item_custody_project ON item_custody_records(project_id, status);

-- 3. Item custody settlements: records each return, consumption, damage, loss, or transfer
CREATE TABLE IF NOT EXISTS item_custody_settlements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    custody_id UUID NOT NULL REFERENCES item_custody_records(id) ON DELETE CASCADE,
    settlement_type TEXT NOT NULL CHECK (settlement_type IN ('return','consume','damage','loss','transfer')),
    quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    performed_by UUID NOT NULL REFERENCES users(id),
    transfer_recipient_id UUID REFERENCES users(id),
    movement_id UUID REFERENCES item_movements(id) ON DELETE SET NULL,
    notes TEXT,
    settled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_custody_settlements_custody ON item_custody_settlements(custody_id, created_at);
