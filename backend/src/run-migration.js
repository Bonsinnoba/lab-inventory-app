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

async function runMigration(file) {
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
    // Existing installations created before migration tracking was introduced
    // may already contain an older migration's objects. Preserve compatibility
    // for those known legacy migrations; all newly-created migrations should be
    // strictly tracked and transactional.
    if (['42P07', '42710', '42701'].includes(err.code)) {
      console.warn(`Legacy migration appears already applied: ${file}`);
      await pool.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [version]);
      return;
    }
    console.error(`Migration failed: ${file}: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

async function runAllMigrations() {
  await ensureMigrationTable();
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) await runMigration(file);
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
