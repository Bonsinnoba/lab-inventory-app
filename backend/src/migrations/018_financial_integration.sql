-- LabOS v1.9: financial integration across projects, budgets and inventory
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS budget_period_id UUID REFERENCES budget_periods(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_transactions_budget_period ON transactions(budget_period_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_project_direction ON transactions(project_id, direction, date DESC);

-- Keep project financial figures queryable without duplicating money in projects.
-- The values are derived from the transaction ledger and inventory allocations.
CREATE OR REPLACE VIEW project_financial_summary AS
SELECT
  p.id AS project_id,
  p.name,
  p.budget,
  COALESCE(SUM(CASE WHEN t.direction = 'expense' THEN t.amount ELSE 0 END), 0)::numeric(14,2) AS actual_expense,
  COALESCE(SUM(CASE WHEN t.direction = 'income' THEN t.amount ELSE 0 END), 0)::numeric(14,2) AS project_income,
  COALESCE(SUM(CASE WHEN t.direction = 'expense' THEN t.amount ELSE -t.amount END), 0)::numeric(14,2) AS net_spend,
  COALESCE((SELECT SUM(pi.allocated_quantity * COALESCE(i.unit_cost, 0)) FROM project_items pi JOIN items i ON i.id = pi.item_id WHERE pi.project_id = p.id), 0)::numeric(14,2) AS allocated_inventory_value
FROM projects p
LEFT JOIN transactions t ON t.project_id = p.id
GROUP BY p.id;

-- A transaction linked to a project expense should also be attributable to a project.
-- This is enforced in the API rather than as a database CHECK so existing legacy rows remain valid.
