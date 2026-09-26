-- Fulfilled reservations are no longer outstanding allocations; stock movement is recorded atomically.
ALTER TABLE project_reservations DROP CONSTRAINT IF EXISTS project_reservations_status_check;
ALTER TABLE project_reservations ADD CONSTRAINT project_reservations_status_check
 CHECK(status IN ('proposed','pending_review','confirmed','rejected','released','fulfilled'));
ALTER TABLE project_reservations ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;
ALTER TABLE project_reservations ADD COLUMN IF NOT EXISTS fulfilled_by UUID REFERENCES users(id);
ALTER TABLE project_reservations ADD COLUMN IF NOT EXISTS fulfillment_movement_id UUID REFERENCES item_movements(id);
