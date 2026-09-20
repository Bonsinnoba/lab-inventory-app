import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const sync = read('src/routes/sync.js');
const resources = read('src/routes/resources.js');
const local = read('../desktop/src-tauri/src/local_resources.rs');

const checks = [
  ['offline resource mutations persist local state and outbox in one SQLite transaction', local.includes('let tx = conn.transaction()') && local.includes('write_resources(&tx, resources)?') && local.includes("INSERT INTO sync_outbox") && local.includes('tx.commit()')],
  ['server resource pull merge is transactional', local.includes('let tx = conn.transaction()') && local.includes('write_resources(&tx, &current)?') && local.includes('tx.commit()')],
  ['server resource pull does not overwrite resources with pending local changes', local.includes("sync_outbox WHERE synced_at IS NULL AND entity_type='resource'") && local.includes('if pending.contains(&incoming_resource.id) { continue; }')],
  ['server deletion pull does not erase a pending local resource mutation', local.includes('current.retain(|r| !deleted.contains(&r.id) || pending.contains(&r.id))')],
  ['offline download requests are represented as outbox changes', local.includes("entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'resource_download_job'")],
  ['server accepts resource download jobs through the sync path', sync.includes("change.entity_type==='resource_download_job'") && sync.includes('applyResourceDownloadJobEntity')],
  ['download job creation is idempotent per active resource', sync.includes("status IN ('queued','scheduled','downloading','paused')") && sync.includes('if(existing.rowCount)return existing.rows[0]')],
  ['resource deletes create server tombstones for convergence', sync.includes("INSERT INTO sync_tombstones(entity_type,entity_id,project_id,item_id,note_id)")],
  ['resource pull returns deletion tombstones', sync.includes("entity_type='resource'") && sync.includes('deleted_resource_ids:deleted')],
  ['direct resource-link creation rolls back failed inserts', resources.includes("await client.query('BEGIN')") && resources.includes("await client.query('ROLLBACK')") && resources.includes("await client.query('COMMIT')")],
  ['local resource duplicate identity includes folder parent scope', local.includes('r.parent_resource_id == parent_resource_id')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`RESOURCE SYNC STATIC TESTS FAILED: ${checks.length - failed}/${checks.length}`);
  process.exit(1);
}
console.log(`RESOURCE SYNC STATIC TESTS PASSED: ${checks.length}/${checks.length}`);
