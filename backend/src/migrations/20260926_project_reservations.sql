-- Reservation requests do not change physical stock. Confirmed allocations reduce available-to-reserve only.
CREATE TABLE IF NOT EXISTS project_reservations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
 requested_by UUID NOT NULL REFERENCES users(id),
 reviewed_by UUID REFERENCES users(id),
 quantity NUMERIC(12,3) NOT NULL CHECK (quantity>0),
 needed_from TIMESTAMPTZ NOT NULL,
 needed_until TIMESTAMPTZ,
 status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','pending_review','confirmed','rejected','released')),
 note TEXT,
 review_note TEXT,
 reviewed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(needed_until IS NULL OR needed_until>needed_from)
);
CREATE INDEX IF NOT EXISTS idx_project_reservations_item ON project_reservations(item_id,status,needed_from,needed_until);
CREATE INDEX IF NOT EXISTS idx_project_reservations_project ON project_reservations(project_id,created_at DESC);
