-- LabOS security controls: active accounts and login audit metadata.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_active ON users (is_active);
CREATE INDEX IF NOT EXISTS idx_audit_log_action_created ON audit_log (action, created_at DESC);
