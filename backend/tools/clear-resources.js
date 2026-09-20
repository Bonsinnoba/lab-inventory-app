import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/db.js';
import { STORAGE_DIR, resolveStoragePath } from '../src/storage.js';

const backupRoot = path.resolve(process.cwd(), 'labos-reset-backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupRoot, `resources-backup-${stamp}.json`);

async function main() {
  console.log('LabOS resource-only reset starting...');

  const client = await pool.connect();
  const storagePaths = new Set();

  try {
    await client.query('BEGIN');

    const resourcesResult = await client.query('SELECT * FROM resources ORDER BY created_at ASC');
    const resources = resourcesResult.rows;

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

    // Do not allow a resource reset to destroy a Canvas block. Existing
    // project_blocks use ON DELETE SET NULL, which intentionally preserves
    // the canvas row. Those resource rows are skipped and reported.
    const protectedResult = await client.query(
      `SELECT DISTINCT resource_id
         FROM project_blocks
        WHERE resource_id IS NOT NULL
          AND resource_id = ANY($1::uuid[])`,
      [resources.map((resource) => resource.id)]
    );
    const protectedIds = new Set(protectedResult.rows.map((row) => row.resource_id));

    const deletable = resources.filter((resource) => !protectedIds.has(resource.id));

    for (const resource of deletable) {
      if (resource.storage_path) storagePaths.add(resource.storage_path);
      storagePaths.add(resource.id);
    }

    for (const resource of deletable) {
      await client.query('DELETE FROM resources WHERE id = $1', [resource.id]);
      await client.query(
        `INSERT INTO sync_tombstones(entity_type, entity_id, project_id, item_id, note_id)
         VALUES ('resource', $1, $2, $3, $4)
         ON CONFLICT(entity_type, entity_id)
         DO UPDATE SET deleted_at = now(),
                       project_id = EXCLUDED.project_id,
                       item_id = EXCLUDED.item_id,
                       note_id = EXCLUDED.note_id`,
        [resource.id, resource.project_id || null, resource.item_id || null, resource.note_id || null]
      );
    }

    // Remove old resource tombstones for rows that were not part of this reset.
    // The deletions above have just created the fresh tombstones we want.
    await client.query(
      `DELETE FROM sync_tombstones t
        WHERE t.entity_type = 'resource'
          AND NOT EXISTS (
            SELECT 1
              FROM resources r
             WHERE r.id = t.entity_id
          )
          AND NOT EXISTS (
            SELECT 1
              FROM project_blocks pb
             WHERE pb.resource_id = t.entity_id
          )
          AND t.entity_id = ANY($1::uuid[])`,
      [deletable.map((resource) => resource.id)]
    );

    await client.query('COMMIT');

    let storageEntriesRemoved = 0;
    for (const storagePath of storagePaths) {
      const target = storagePath.includes('/') ? resolveStoragePath(storagePath) : resolveStoragePath(storagePath);
      await fs.rm(target, { recursive: true, force: true });
      storageEntriesRemoved += 1;
    }

    console.log('');
    console.log('RESOURCE RESET COMPLETE');
    console.log(`Resources found: ${resources.length}`);
    console.log(`Resources deleted: ${deletable.length}`);
    console.log(`Resources skipped because they are used by Canvas: ${protectedIds.size}`);
    console.log(`Storage paths removed: ${storageEntriesRemoved}`);
    console.log(`Backup: ${backupFile}`);
    if (protectedIds.size) {
      console.log('');
      console.log('Skipped Canvas-linked resource IDs:');
      for (const id of protectedIds) console.log(`  - ${id}`);
    }
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
