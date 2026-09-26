ALTER TABLE project_reservation_fulfillments ADD COLUMN IF NOT EXISTS request_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservation_fulfillments_request ON project_reservation_fulfillments(reservation_id,request_id) WHERE request_id IS NOT NULL;
