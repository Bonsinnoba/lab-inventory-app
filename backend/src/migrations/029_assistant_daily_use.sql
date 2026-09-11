-- LabOS Track 5 Phase 1: persistent assistant context preferences.
CREATE TABLE IF NOT EXISTS assistant_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  context_scope TEXT NOT NULL DEFAULT 'none' CHECK (context_scope IN ('none','project','project_workspace','project_lab_data','full_project','custom')),
  context_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  context_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
