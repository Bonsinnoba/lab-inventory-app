-- Remaining allocation reaches zero on final fulfillment. Preserve all rows and
-- original quantities; zero is not valid for a new or still-confirmed request.
ALTER TABLE project_reservations
  DROP CONSTRAINT IF EXISTS project_reservations_quantity_check;
ALTER TABLE project_reservations
  ADD CONSTRAINT project_reservations_quantity_check
  CHECK (quantity > 0 OR (quantity = 0 AND status = 'fulfilled'));
