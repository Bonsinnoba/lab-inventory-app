-- Migration: optional title on project_blocks
--
-- Blocks previously had no user-facing label besides their type
-- (e.g. "TEXT", "IMAGE"). This adds a nullable title so any block --
-- text or media -- can be given a short name from the canvas UI.

ALTER TABLE project_blocks ADD COLUMN IF NOT EXISTS title TEXT;
