import { pool } from './db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

// These migrations predate migration tracking. They may already exist on an
// installation whose database was initialized from schema.sql and upgraded
// manually. We only allow duplicate-object adoption during that one-time legacy
// transition; once tracking contains any row, every migration is strict.
const LEGACY_MIGRATION_PATTERNS = [
  /^0(0[3-9]|[12][0-9]|3[0-9]|40|41)_/, 
  /^20260914_/
];

function isLegacyMigration(file) {
  return LEGACY_MIGRATION_PATTERNS.some((pattern) => pattern.test(file));
}

async function runMigration(file, legacyAdoption) {
  const version = file.replace(/\.sql$/, '');
  const already = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version]);
  if (already.rowCount) {
    console.log(`Skipping migration: ${file}`);
    return;
  }

  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    await client.query('COMMIT');
    console.log(`Applied migration: ${file}`);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '42P07' || err.code === '42710' || err.code === '42701') {
      if (legacyAdoption && isLegacyMigration(file)) {
        console.warn(`Adopting pre-existing legacy migration: ${file}`);
        await pool.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [version]);
        return;
      }
    }
    console.error(`Migration failed: ${file}: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

async function runAllMigrations() {
  await ensureMigrationTable();
  const state = await pool.query('SELECT COUNT(*)::int AS count FROM schema_migrations');
  const legacyAdoption = state.rows[0].count === 0;
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) await runMigration(file, legacyAdoption);
}

runAllMigrations()
  .then(async () => {
    console.log('All migrations completed');
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Migration run aborted:', err.message);
    await pool.end();
    process.exit(1);
  });
