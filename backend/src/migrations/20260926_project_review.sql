-- Planning review is independent of project lifecycle status.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'draft'
  CHECK (review_status IN ('draft','submitted','changes_requested','approved'));
CREATE TABLE IF NOT EXISTS project_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('submit','request_changes','approve')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_review_events_project ON project_review_events(project_id,created_at DESC);
