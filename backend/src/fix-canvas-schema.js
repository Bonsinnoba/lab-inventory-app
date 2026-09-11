// fix-canvas-schema.js
//
// A direct, standalone fix for the "column x of relation project_blocks
// does not exist" error. Connects using the exact same .env config the
// app itself uses (no separate setup needed), checks the ACTUAL live
// schema of project_blocks, and either confirms it's already correct
// or fixes it on the spot — printing the real column list at the end
// either way, so there's no ambiguity about whether it worked.
//
// Run this directly if you're still seeing "column x does not exist"
// after re-running copy-to-project.bat — it's the same fix that script
// runs via the migrations, but this skips every other step and reports
// in much more detail exactly what it found and did.
//
// Usage (from the backend/ folder):
//   node src/fix-canvas-schema.js

import { pool } from './db.js';

async function main() {
  console.log('Connecting to the database configured in .env...');

  const dbInfo = await pool.query('SELECT current_database() AS db, inet_server_addr() AS host');
  console.log(`Connected to database "${dbInfo.rows[0].db}"`);
  console.log();

  const tableExists = await pool.query(`
    SELECT 1 FROM information_schema.tables WHERE table_name = 'project_blocks'
  `);

  if (tableExists.rows.length === 0) {
    console.log('project_blocks does not exist at all yet — creating it fresh.');
    await createCorrectSchema();
    await reportFinalSchema();
    process.exit(0);
  }

  const columns = await pool.query(`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'project_blocks'
  `);
  const columnNames = columns.rows.map((r) => r.column_name);
  console.log('Current project_blocks columns:', columnNames.join(', '));
  console.log();

  const hasOldSchema = columnNames.includes('row_index');
  const hasNewSchema = columnNames.includes('x') && columnNames.includes('width');

  if (hasNewSchema && !hasOldSchema) {
    console.log('project_blocks already has the correct free-form (x, y, width, height) schema.');
    console.log('If you are still seeing "column x does not exist", the backend server you');
    console.log('are actually running is pointed at a DIFFERENT database than this script just');
    console.log(`checked (this script connected to "${dbInfo.rows[0].db}" using backend/.env —`);
    console.log('confirm that matches PGDATABASE in the .env the running server actually loaded,');
    console.log('and that you fully restarted the backend server after any recent change).');
    process.exit(0);
  }

  console.log('Old row/column-based schema detected (or schema is incomplete) — fixing now.');
  console.log('This drops and recreates project_blocks and project_connectors. Any existing');
  console.log('canvas blocks/connectors will be lost — nothing else (items, transactions,');
  console.log('notes, resources) is touched.');
  console.log();

  await pool.query('DROP TABLE IF EXISTS project_connectors CASCADE');
  await pool.query('DROP TABLE IF EXISTS project_blocks CASCADE');
  await createCorrectSchema();
  await reportFinalSchema();
  console.log();
  console.log('Done. Restart the backend server now if it was already running.');
  process.exit(0);
}

async function createCorrectSchema() {
  await pool.query(`
    CREATE TABLE project_blocks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        block_type TEXT NOT NULL CHECK (
            block_type IN ('text', 'image', 'video', 'pdf', 'audio', 'link', 'folder')
        ),
        text_content TEXT,
        resource_id UUID REFERENCES resources(id) ON DELETE SET NULL,
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
    )
  `);
  await pool.query(`
    CREATE TABLE project_connectors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        source_block_id UUID NOT NULL REFERENCES project_blocks(id) ON DELETE CASCADE,
        target_block_id UUID NOT NULL REFERENCES project_blocks(id) ON DELETE CASCADE,
        label TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT no_self_connection CHECK (source_block_id != target_block_id)
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_project_blocks_project ON project_blocks (project_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_project_connectors_project ON project_connectors (project_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_project_connectors_source ON project_connectors (source_block_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_project_connectors_target ON project_connectors (target_block_id)');
}

async function reportFinalSchema() {
  const columns = await pool.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'project_blocks' ORDER BY ordinal_position
  `);
  console.log();
  console.log('project_blocks now has these columns:');
  for (const row of columns.rows) {
    console.log(`  ${row.column_name} (${row.data_type})`);
  }
}

main().catch((err) => {
  console.error('Failed:', err.message);
  console.error();
  console.error('This is most likely a database connection problem — check that PGHOST/');
  console.error('PGPORT/PGDATABASE/PGUSER/PGPASSWORD in backend/.env are correct and that');
  console.error('Postgres is actually running.');
  process.exit(1);
});
