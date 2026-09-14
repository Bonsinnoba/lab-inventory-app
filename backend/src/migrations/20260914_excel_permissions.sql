-- LabOS v1: per-user permission overrides.
-- NULL/absent override means the user's role baseline applies.
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('grant', 'deny')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_user_permission_overrides_user ON user_permission_overrides(user_id);
