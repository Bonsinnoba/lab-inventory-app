-- Expand account roles while preserving existing admin/member accounts.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'researcher', 'technician', 'viewer', 'member'));

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
