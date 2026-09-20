-- Migration: Project canvas (blocks & connectors) — free-form positioning
--
-- Revision note: this replaces an earlier version of this migration that
-- used a snapped 3-column grid (row_index/col_start/col_span) with shared
-- row heights. That model is gone -- blocks now have independent (x, y)
-- position and (width, height) size in pixels, placeable anywhere on the
-- canvas with no overlap restriction and no shared-row-height concept.
--
-- This file is SAFE TO RE-RUN. If a database already has the old
-- row/column-based project_blocks table (from before this rewrite), this
-- detects that and drops+recreates it with the correct free-form columns
-- -- rather than erroring with "relation already exists" or silently
-- leaving the old, incompatible schema in place (which is what caused
-- "column x does not exist" errors against a database that was never
-- migrated after this schema changed). If the table is already correct,
-- this is a no-op.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'project_blocks' AND column_name = 'row_index'
    ) THEN
        RAISE NOTICE 'Old row/column-based project_blocks schema detected -- dropping and recreating with free-form (x, y, width, height) columns.';
        DROP TABLE IF EXISTS project_connectors CASCADE;
        DROP TABLE IF EXISTS project_blocks CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS project_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    block_type TEXT NOT NULL CHECK (
        block_type IN ('text', 'image', 'video', 'pdf', 'audio', 'link', 'folder')
    ),
    text_content TEXT,
    resource_id UUID REFERENCES resources(id) ON DELETE SET NULL,

    -- Free-form canvas position and size, in pixels. (x, y) is the
    -- block's top-left corner relative to the canvas origin. Independent
    -- per block -- no grid, no row-sharing, no overlap validation.
    x INT NOT NULL DEFAULT 0,
    y INT NOT NULL DEFAULT 0,
    width INT NOT NULL DEFAULT 320 CHECK (width >= 120),
    height INT NOT NULL DEFAULT 200 CHECK (height >= 80),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT block_content_matches_type CHECK (
        (block_type = 'text' AND text_content IS NOT NULL) OR
        (block_type != 'text' AND resource_id IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS project_connectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_block_id UUID NOT NULL REFERENCES project_blocks(id) ON DELETE CASCADE,
    target_block_id UUID NOT NULL REFERENCES project_blocks(id) ON DELETE CASCADE,
    label TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT no_self_connection CHECK (source_block_id != target_block_id)
);

CREATE INDEX IF NOT EXISTS idx_project_blocks_project ON project_blocks (project_id);
CREATE INDEX IF NOT EXISTS idx_project_connectors_project ON project_connectors (project_id);
CREATE INDEX IF NOT EXISTS idx_project_connectors_source ON project_connectors (source_block_id);
CREATE INDEX IF NOT EXISTS idx_project_connectors_target ON project_connectors (target_block_id);
