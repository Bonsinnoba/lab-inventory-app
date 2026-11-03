CREATE TABLE IF NOT EXISTS assistant_proposals (
 id UUID PRIMARY KEY,
 author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0),
 title TEXT NOT NULL,
 graph JSONB NOT NULL,
 generation_id UUID,
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','accepted','deleted')),
 accepted_change_id TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assistant_proposals_author ON assistant_proposals(author_id,updated_at);
CREATE TABLE IF NOT EXISTS assistant_proposal_generations (
 id UUID PRIMARY KEY,
 author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL,
 target_project_id UUID,
 state TEXT NOT NULL CHECK(state IN ('pending','ready','failed')),
 result JSONB,
 provenance JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
