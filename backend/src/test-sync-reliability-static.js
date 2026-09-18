import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const sync = read('src/routes/sync.js');
const desktopSync = read('../desktop/src/api/sync.ts');
const app = read('../desktop/src/App.tsx');
const syncStatus = read('../desktop/src/components/SyncStatus.tsx');
const localDb = read('../desktop/src-tauri/src/local_db.rs');
const localInventory = read('../desktop/src/api/local-inventory.ts');
const localExcel = read('../desktop/src-tauri/src/local_excel.rs');
const localProjects = read('../desktop/src-tauri/src/local_projects.rs');
const tauriMain = read('../desktop/src-tauri/src/main.rs');
const tauriConfig = read('../desktop/src-tauri/tauri.conf.json');
const viteConfig = read('../desktop/vite.config.ts');

const checks = [
  ['server sync push endpoint exists', sync.includes("router.post('/push'")],
  ['server sync pull endpoint exists', sync.includes("router.get('/pull'")],
  ['server idempotency is checked before apply', sync.includes('SELECT payload_json,response_json FROM sync_idempotency') && sync.includes('change_id=$1 FOR UPDATE')],
  ['server rejects idempotency payload mismatch', sync.includes('IDEMPOTENCY_PAYLOAD_MISMATCH')],
  ['server detects stale item updates', sync.includes('SYNC_CONFLICT') && sync.includes('base_updated_at')],
  ['server supports explicit local conflict retry', sync.includes("payload.conflict_resolution") && sync.includes("'keep_local'")],
  ['server pull uses composite cursor ordering', sync.includes('event_at > $1') && sync.includes('event_type > $2') && sync.includes('event_id > $3')],
  ['server pull reports pagination state', sync.includes('has_more') && sync.includes('next_cursor')],
  ['server accepts offline project entities', sync.includes('PROJECT_ENTITY_CONFIG') && sync.includes('project_task') && sync.includes('project_experiment') && sync.includes('project_bom')],
  ['server exposes project workspace pull', sync.includes("router.get('/projects/pull'") && sync.includes('deleted_project_ids')],
  ['project sync enforces project edit access', sync.includes('PROJECT_ACCESS_DENIED') && sync.includes('canEditProject')],
  ['desktop persists sync runtime status', desktopSync.includes('STATUS_KEY') && desktopSync.includes('localStorage.setItem(STATUS_KEY')],
  ['desktop restores sync error after restart', desktopSync.includes('loadRuntimeState') && desktopSync.includes("return {status:lastError?'error':'idle'")],
  ['desktop prevents overlapping sync runs', desktopSync.includes('activeSync') && desktopSync.includes('if(activeSync)return activeSync')],
  ['desktop has exponential retry backoff', desktopSync.includes('RETRY_DELAYS_MS') && desktopSync.includes('scheduleRetry')],
  ['desktop persists retry state', desktopSync.includes('RETRY_KEY') && desktopSync.includes('persistRetryState') && desktopSync.includes('loadRetryState')],
  ['manual retry bypasses backoff', desktopSync.includes('syncPendingChanges(force=false)') && desktopSync.includes('if(!force&&nextRetryAt>Date.now())')],
  ['reconnect bypasses backoff', app.includes("const recover = () => { void syncPendingChanges(true); }")],
  ['conflict retry bypasses backoff', syncStatus.includes('syncPendingChanges(true)')],
  ['local conflict table is persistent', localDb.includes('CREATE TABLE IF NOT EXISTS sync_conflicts')],
  ['local conflict resolutions are transactional', localDb.includes('let tx=conn.transaction()') && localDb.includes('UPDATE sync_conflicts SET resolved_at') && localDb.includes('tx.commit()')],
  ['accept-server resets pull cursor', localDb.includes("DELETE FROM sync_state WHERE key='inventory_sync_cursor'")],
  ['server pull merge is transactional', localDb.includes('apply_server_inventory_pull') && localDb.includes('let tx=conn.transaction()')],
  ['pending local items are protected during pull', localDb.includes("WHERE synced_at IS NULL AND entity_type='item'") && localDb.includes('if(pending.contains(&item_id)){continue;}')],
  ['local project pull merge exists', localProjects.includes('apply_server_project_pull') && localProjects.includes('pending_key')],
  ['Tauri registers project pull merge command', tauriMain.includes('local_projects::apply_server_project_pull')],
  ['item updates include base timestamp', localInventory.includes('base_updated_at:baseUpdatedAt')],
  ['Excel updates include base timestamp', localExcel.includes('base_updated_at') && localExcel.includes('base_updated_at: base_updated_at')],
  ['Excel import is transactional', localExcel.includes('let tx = conn.transaction()') && localExcel.includes('tx.commit()')],
  ['desktop pull pages until complete', desktopSync.includes('for(let page=0;page<100;page++)') && desktopSync.includes('body.has_more')],
  ['desktop pulls project workspace state', desktopSync.includes("/sync/projects/pull") && desktopSync.includes('apply_server_project_pull')],
  ['Tauri dev URL matches Vite dev server', tauriConfig.includes('"devPath": "http://localhost:1420"') && viteConfig.includes('port: 1420')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`SYNC RELIABILITY STATIC TESTS FAILED: ${checks.length - failed}/${checks.length}`);
  process.exit(1);
}
console.log(`SYNC RELIABILITY STATIC TESTS PASSED: ${checks.length}/${checks.length}`);
