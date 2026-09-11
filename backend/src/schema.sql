-- Lab Inventory & Management App — schema
-- Run with: psql -U your_user -d your_db -f schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'researcher', 'technician', 'viewer', 'member')),
    display_name TEXT,
    email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (lower(email)) WHERE email IS NOT NULL;

-- ============================================================
-- LOCATIONS (hierarchical: Room -> Shelf -> Bin, via parent_id)
-- ============================================================
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    parent_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PROJECTS
-- ============================================================
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'on_hold', 'cancelled')),
    budget NUMERIC(12, 2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- ITEMS (tools, components, equipment, materials — unified table)
-- ============================================================
CREATE TABLE items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('tool', 'component', 'equipment', 'material', 'chemical', 'consumable', 'instrument', 'spare_part')),
    category TEXT,
    sku TEXT UNIQUE,

    initial_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0,
    current_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0,
    unit TEXT,              -- e.g. 'pcs', 'meters', 'liters', 'kg'
    dimensions TEXT,        -- free-text for items better described by size than count

    status TEXT NOT NULL DEFAULT 'available' CHECK (
        status IN ('available', 'in_use', 'damaged', 'needs_repair', 'needs_replacement', 'low_stock', 'retired')
    ),
    condition_notes TEXT,
    last_checked_at TIMESTAMPTZ,

    unit_cost NUMERIC(12, 2),
    replacement_cost NUMERIC(12, 2),
    supplier TEXT,
    part_number TEXT,

    location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    photo_url TEXT,
    manufacturer TEXT,
    model_number TEXT,
    serial_number TEXT,
    asset_tag TEXT,
    calibration_interval_days INTEGER,
    next_calibration_date DATE,

    -- full-text search vector, kept up to date by the trigger below
    search_vector TSVECTOR,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_items_search ON items USING GIN (search_vector);
CREATE INDEX idx_items_status ON items (status);
CREATE INDEX idx_items_type ON items (type);
CREATE INDEX IF NOT EXISTS idx_items_supplier ON items (supplier);
CREATE INDEX IF NOT EXISTS idx_items_part_number ON items (part_number);
CREATE INDEX IF NOT EXISTS idx_items_assigned_to ON items (assigned_to);
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_serial_number_unique ON items (serial_number) WHERE serial_number IS NOT NULL AND serial_number <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_asset_tag_unique ON items (asset_tag) WHERE asset_tag IS NOT NULL AND asset_tag <> '';
CREATE INDEX IF NOT EXISTS idx_items_calibration_due ON items (next_calibration_date);

CREATE FUNCTION items_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.category, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.condition_notes, '')), 'C');
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_search_vector_trigger
    BEFORE INSERT OR UPDATE ON items
    FOR EACH ROW EXECUTE FUNCTION items_search_vector_update();

-- ============================================================
-- FUNDING SOURCES (donors, investors, grant bodies, institutional allocations)
-- ============================================================
CREATE TABLE funding_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('donor', 'investor', 'grant_body', 'institutional', 'other')),
    contact_info TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- BUDGET PERIODS (track budget across fiscal periods)
-- ============================================================
CREATE TABLE budget_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label TEXT NOT NULL,
    total_budget NUMERIC(12, 2) NOT NULL,
    start_date DATE,
    end_date DATE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- TRANSACTIONS (financial log — purchases, repairs, replacements, project spend)
-- ============================================================
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL CHECK (type IN ('purchase', 'repair', 'replacement', 'project_expense', 'other', 'donation', 'investment', 'grant', 'lab_allocation', 'other_income')),
    direction TEXT NOT NULL DEFAULT 'expense' CHECK (direction IN ('income', 'expense')),
    amount NUMERIC(12, 2) NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    vendor TEXT,
    notes TEXT,

    item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    logged_by UUID REFERENCES users(id) ON DELETE SET NULL,
    funding_source_id UUID REFERENCES funding_sources(id) ON DELETE SET NULL,

    search_vector TSVECTOR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transactions_search ON transactions USING GIN (search_vector);
CREATE INDEX idx_transactions_date ON transactions (date);
CREATE INDEX idx_transactions_type ON transactions (type);

CREATE FUNCTION transactions_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.vendor, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.notes, '')), 'B');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transactions_search_vector_trigger
    BEFORE INSERT OR UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION transactions_search_vector_update();

-- ============================================================
-- NOTES (notebook — linkable to items/projects, taggable)
-- ============================================================
CREATE TABLE notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    tags TEXT[] DEFAULT '{}',

    item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    author_id UUID REFERENCES users(id) ON DELETE SET NULL,

    search_vector TSVECTOR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notes_search ON notes USING GIN (search_vector);
CREATE INDEX idx_notes_tags ON notes USING GIN (tags);

CREATE FUNCTION notes_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.body, '')), 'B');
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER notes_search_vector_trigger
    BEFORE INSERT OR UPDATE ON notes
    FOR EACH ROW EXECUTE FUNCTION notes_search_vector_update();

-- ============================================================
-- RESOURCES (uploaded files, schematic folders, and external links —
-- attachable to an item, a project, or a note. Exactly one of
-- item_id / project_id / note_id should be set per resource.)
--
-- Files are stored on the backend server's disk (see
-- backend/src/storage.js) — this table only holds metadata + the
-- server-relative storage path. Folders are represented as a parent
-- 'folder' resource with child 'file' resources pointing back to it
-- via parent_resource_id, each carrying its relative_path so the
-- original folder structure can be reconstructed on download.
-- ============================================================
CREATE TABLE resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,                 -- display name (filename, folder name, or link title)
    kind TEXT NOT NULL CHECK (kind IN ('file', 'folder', 'link')),
    file_type TEXT NOT NULL CHECK (
        file_type IN ('image', 'video', 'audio', 'pdf', 'document', 'schematic_folder', 'youtube', 'other')
    ),

    -- for kind='file': path on the server's disk, relative to STORAGE_DIR
    storage_path TEXT,
    original_filename TEXT,
    mime_type TEXT,
    size_bytes BIGINT,

    -- for kind='folder': child files reference the folder via this,
    -- carrying their path within the folder (e.g. 'rev2/board.dwg')
    parent_resource_id UUID REFERENCES resources(id) ON DELETE CASCADE,
    relative_path TEXT,

    -- for kind='link': the external URL (e.g. a YouTube video)
    url TEXT,
    thumbnail_url TEXT,          -- auto-fetched for YouTube links
    category TEXT NOT NULL DEFAULT 'general',
    description TEXT NOT NULL DEFAULT '',
    tags TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    item_id UUID REFERENCES items(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    note_id UUID REFERENCES notes(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,

    search_vector TSVECTOR,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT resources_exactly_one_parent CHECK (
        (CASE WHEN item_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN project_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN note_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN parent_resource_id IS NOT NULL THEN 1 ELSE 0 END) = 1
    )
);

CREATE INDEX idx_resources_search ON resources USING GIN (search_vector);
CREATE INDEX idx_resources_item ON resources (item_id);
CREATE INDEX idx_resources_project ON resources (project_id);
CREATE INDEX idx_resources_note ON resources (note_id);
CREATE INDEX idx_resources_parent ON resources (parent_resource_id);
CREATE INDEX idx_resources_category ON resources (category);
CREATE INDEX idx_resources_tags ON resources USING GIN (tags);
CREATE INDEX idx_resources_updated_at ON resources (updated_at DESC);

CREATE FUNCTION resources_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(NEW.category, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'B');
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER resources_search_vector_trigger
    BEFORE INSERT OR UPDATE ON resources
    FOR EACH ROW EXECUTE FUNCTION resources_search_vector_update();


-- ============================================================
-- INVENTORY MOVEMENTS + MAINTENANCE
-- ============================================================
CREATE TABLE IF NOT EXISTS item_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('receive','checkout','return','consume','adjust','transfer','damage','loss','repair_out','repair_in')),
    quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    quantity_before NUMERIC(12,3) NOT NULL,
    quantity_after NUMERIC(12,3) NOT NULL CHECK (quantity_after >= 0),
    from_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    to_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    reason TEXT,
    reference TEXT,
    performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_item_movements_item ON item_movements(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_movements_project ON item_movements(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS maintenance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    maintenance_type TEXT NOT NULL DEFAULT 'routine' CHECK (maintenance_type IN ('routine','repair','inspection','calibration','cleaning','other')),
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
    scheduled_date DATE,
    completed_date DATE,
    performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT,
    cost NUMERIC(12,2),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_maintenance_item ON maintenance_records(item_id, scheduled_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_due ON maintenance_records(status, scheduled_date);


-- ============================================================
-- KNOWLEDGE HISTORY (v1.5)
-- ============================================================
CREATE TABLE IF NOT EXISTS note_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    title TEXT NOT NULL, body TEXT NOT NULL, tags TEXT[] NOT NULL DEFAULT '{}',
    edited_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_note_revisions_note ON note_revisions (note_id, created_at DESC);

CREATE TABLE IF NOT EXISTS resource_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    storage_path TEXT NOT NULL, original_filename TEXT, mime_type TEXT, size_bytes BIGINT,
    version_number INTEGER NOT NULL, uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(resource_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_resource_versions_resource ON resource_versions (resource_id, version_number DESC);
