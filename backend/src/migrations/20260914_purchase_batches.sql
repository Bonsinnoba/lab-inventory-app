CREATE TABLE IF NOT EXISTS purchase_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT NOT NULL,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier TEXT,
  invoice_number TEXT,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_batches_date ON purchase_batches(purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_batches_supplier ON purchase_batches(supplier);
CREATE INDEX IF NOT EXISTS idx_purchase_batches_project ON purchase_batches(project_id);

CREATE TABLE IF NOT EXISTS purchase_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_batch_id UUID NOT NULL REFERENCES purchase_batches(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14,2) NOT NULL CHECK (unit_cost >= 0),
  tax NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  line_total NUMERIC(14,2) NOT NULL CHECK (line_total >= 0),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_purchase_lines_batch ON purchase_lines(purchase_batch_id);
CREATE INDEX IF NOT EXISTS idx_purchase_lines_item ON purchase_lines(item_id);
