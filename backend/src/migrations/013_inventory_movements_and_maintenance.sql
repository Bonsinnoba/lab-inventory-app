-- LabOS Inventory 2.0: auditable stock movements and maintenance records.

CREATE TABLE IF NOT EXISTS item_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    movement_type TEXT NOT NULL CHECK (movement_type IN (
        'receive', 'checkout', 'return', 'consume', 'adjust', 'transfer', 'damage', 'loss', 'repair_out', 'repair_in'
    )),
    quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    quantity_before NUMERIC(12,3) NOT NULL,
    quantity_after NUMERIC(12,3) NOT NULL CHECK (quantity_after >= 0),
    from_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    to_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    reason TEXT,
    reference TEXT,
    performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_item_movements_item ON item_movements(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_movements_project ON item_movements(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS maintenance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    maintenance_type TEXT NOT NULL DEFAULT 'routine' CHECK (maintenance_type IN ('routine','repair','inspection','calibration','cleaning','other')),
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
    scheduled_date DATE,
    completed_date DATE,
    performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    cost NUMERIC(12,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maintenance_item ON maintenance_records(item_id, scheduled_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_due ON maintenance_records(status, scheduled_date);

ALTER TABLE item_movements ADD CONSTRAINT item_movements_location_check
  CHECK (movement_type <> 'transfer' OR to_location_id IS NOT NULL);
