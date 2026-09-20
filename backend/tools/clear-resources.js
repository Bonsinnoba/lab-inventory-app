import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/db.js';
import { STORAGE_DIR } from '../src/storage.js';

const backupRoot = path.resolve(process.cwd(), 'labos-reset-backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupRoot, `resources-backup-${stamp}.json`);

async function clearResourceStorage() {
  try {
    const entries = await fs.readdir(STORAGE_DIR, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (entry.name === '.gitkeep' || entry.name === '_incoming') continue;
      await fs.rm(path.join(STORAGE_DIR, entry.name), { recursive: true, force: true });
      removed += 1;
    }
    return removed;
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
}

async function main() {
  console.log('LabOS resource-only reset starting...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const resources = (await client.query('SELECT * FROM resources ORDER BY created_at ASC')).rows;
    await fs.mkdir(backupRoot, { recursive: true });
    await fs.writeFile(
      backupFile,
      JSON.stringify(
        { created_at: new Date().toISOString(), resource_count: resources.length, resources },
        null,
        2
      ),
      'utf8'
    );

    // Download jobs reference resources with ON DELETE CASCADE.
    // Item profile-image references use ON DELETE SET NULL.
    // Remove resource tombstones too so this is a genuinely clean resource test.
    const deleted = await client.query('DELETE FROM resources');
    await client.query("DELETE FROM sync_tombstones WHERE entity_type = 'resource'");

    await client.query('COMMIT');

    const storageEntriesRemoved = await clearResourceStorage();

    console.log('');
    console.log('RESOURCE RESET COMPLETE');
    console.log(`Resources deleted: ${deleted.rowCount}`);
    console.log(`Storage entries removed: ${storageEntriesRemoved}`);
    console.log(`Backup: ${backupFile}`);
    console.log('');
    console.log('The rest of the LabOS database was not modified.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('');
    console.error('RESOURCE RESET FAILED:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
