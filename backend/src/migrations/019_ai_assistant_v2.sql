-- LabOS v2.0: governed AI assistant telemetry and ownership boundaries.
-- AI remains read-only in v2.0. These tables record what the assistant did
-- without giving it write access to laboratory data.

CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
  ON conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running','completed','failed','cancelled')),
    tool_rounds INTEGER NOT NULL DEFAULT 0 CHECK (tool_rounds >= 0),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    error_code TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ai_runs_user_started
  ON ai_runs(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_runs_conversation
  ON ai_runs(conversation_id, started_at DESC);

CREATE TABLE IF NOT EXISTS ai_tool_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_summary JSONB,
    status TEXT NOT NULL CHECK (status IN ('completed','failed')),
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_tool_calls_run_created
  ON ai_tool_calls(run_id, created_at);

-- Legacy conversations created before v2.0 may have no owner. New assistant
-- endpoints will never expose or mutate those records through a user session.
