-- Track the current user responsible for an inventory asset.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_items_assigned_to ON items (assigned_to);
