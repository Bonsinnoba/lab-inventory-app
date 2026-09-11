-- LabOS v1.6: global search foundation
-- Existing GIN indexes remain the primary search path. This migration adds
-- indexes that support discovery/filtering of knowledge metadata and keeps
-- updated timestamps inexpensive for recent-result ordering.
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects (status);
CREATE INDEX IF NOT EXISTS idx_items_status_type ON items (status, type);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date DESC);
CREATE INDEX IF NOT EXISTS idx_resources_category_updated ON resources (category, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes (updated_at DESC);
