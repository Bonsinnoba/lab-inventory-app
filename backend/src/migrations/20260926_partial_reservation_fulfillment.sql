ALTER TABLE project_reservations ADD COLUMN IF NOT EXISTS original_quantity NUMERIC(12,3);
UPDATE project_reservations SET original_quantity=quantity WHERE original_quantity IS NULL;
ALTER TABLE project_reservations ALTER COLUMN original_quantity SET NOT NULL;
ALTER TABLE project_reservations ADD COLUMN IF NOT EXISTS fulfilled_quantity NUMERIC(12,3) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS project_reservation_fulfillments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 reservation_id UUID NOT NULL REFERENCES project_reservations(id) ON DELETE RESTRICT,
 movement_id UUID NOT NULL UNIQUE REFERENCES item_movements(id),
 quantity NUMERIC(12,3) NOT NULL CHECK(quantity>0),
 performed_by UUID REFERENCES users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reservation_fulfillments_reservation ON project_reservation_fulfillments(reservation_id,created_at);
