import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const sync = read('src/routes/sync.js');
const desktopSync = read('../desktop/src/api/sync.ts');
const syncApi = desktopSync;
const projectsApi = read('../desktop/src/api/projects.ts');
const app = read('../desktop/src/App.tsx');
const syncStatus = read('../desktop/src/components/SyncStatus.tsx');
const localDb = read('../desktop/src-tauri/src/local_db.rs');
const localInventory = read('../desktop/src/api/local-inventory.ts');
const itemsApi = read('../desktop/src/api/items.ts');
const localExcel = read('../desktop/src-tauri/src/local_excel.rs');
const localProjects = read('../desktop/src-tauri/src/local_projects.rs');
const localSearch = read('../desktop/src-tauri/src/local_search.rs');
const localFinance = read('../desktop/src-tauri/src/local_finance.rs');
const locationsApi = read('../desktop/src/api/locations.ts');
const localLocations = read('../desktop/src-tauri/src/local_locations.rs');
const financeApi = read('../desktop/src/api/transactions.ts') + read('../desktop/src/api/budget-periods.ts') + read('../desktop/src/api/funding-sources.ts');
const searchApi = read('../desktop/src/api/search.ts');
const tauriMain = read('../desktop/src-tauri/src/main.rs');
const localAuth = read('../desktop/src-tauri/src/local_auth.rs');
const authApi = read('../desktop/src/api/auth.ts');
const localSystem = read('../desktop/src-tauri/src/local_system.rs');
const systemApi = read('../desktop/src/api/system.ts');
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
  ['server syncs project canvas entities', sync.includes('project_block') && sync.includes('project_connector') && sync.includes('project_blocks') && sync.includes('project_connectors')],
  ['server propagates project canvas tombstones', sync.includes('deleted_project_entities')],
  ['local project canvas runtime exists', localProjects.includes('get_local_project_canvas') && localProjects.includes('create_local_project_block') && localProjects.includes('create_local_project_connector')],
  ['local project canvas queues sync changes', localProjects.includes('project_block') && localProjects.includes('project_connector')],
  ['desktop canvas prefers local runtime', read('../desktop/src/api/canvas.ts').includes('get_local_project_canvas') && read('../desktop/src/api/canvas.ts').includes('create_local_project_block')],
  ['desktop project pull carries canvas tombstones', desktopSync.includes('deletedProjectBlockIds') && desktopSync.includes('deletedProjectConnectorIds')],
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
  ['pending local items are protected during pull', localDb.includes("WHERE synced_at IS NULL AND entity_type='item'") && /if\s+pending\.contains\(&item_id\)\s*\{\s*continue;\s*\}/.test(localDb)],
  ['local project pull merge exists', localProjects.includes('apply_server_project_pull') && localProjects.includes('pending_key')],
  ['Tauri registers project pull merge command', tauriMain.includes('local_projects::apply_server_project_pull')],
  ['item updates include base timestamp', localInventory.includes('base_updated_at:baseUpdatedAt')],
  ['Excel updates include base timestamp', localExcel.includes('base_updated_at') && localExcel.includes('"base_updated_at": base_updated_at')],
  ['Excel import is transactional', localExcel.includes('let tx = conn.transaction()') && localExcel.includes('tx.commit()')],
  ['desktop pull pages until complete', desktopSync.includes('for(let page=0;page<100;page++)') && desktopSync.includes('body.has_more')],
  ['desktop pulls project workspace state', desktopSync.includes("/sync/projects/pull") && desktopSync.includes('apply_server_project_pull')],
  ['server accepts offline resource records', sync.includes('applyResourceEntity') && sync.includes("change.entity_type==='resource'")],
  ['server exposes resource pull', sync.includes("router.get('/resources/pull'") && sync.includes('deleted_resource_ids')],
  ['resource sync enforces resource permissions', sync.includes('resources.create') && sync.includes('resources.edit') && sync.includes('resources.delete')],
  ['local resource mutations queue sync changes', read('../desktop/src-tauri/src/local_resources.rs').includes("entity_type,entity_id,operation,payload_json) VALUES(?1,?2,'resource'")],
  ['local resource folder creation queues sync', read('../desktop/src-tauri/src/local_resources.rs').includes('create_local_resource_folder') && read('../desktop/src-tauri/src/local_resources.rs').includes('save_with_change(&mut conn, &resources, &id, "create"')],
  ['local resource deletion queues sync', read('../desktop/src-tauri/src/local_resources.rs').includes('save_with_change(&mut conn, &resources, &id, "delete"')],
  ['local resource pull preserves pending edits', read('../desktop/src-tauri/src/local_resources.rs').includes("entity_type='resource'") && read('../desktop/src-tauri/src/local_resources.rs').includes('pending.contains(&incoming_resource.id)')],
  ['desktop pulls resource records', desktopSync.includes('/sync/resources/pull') && desktopSync.includes('apply_server_resource_pull')],
  ['Tauri registers resource pull merge command', tauriMain.includes('local_resources::apply_server_resource_pull')],
  ['local search runtime exists', localSearch.includes('global_local_search') && localSearch.includes('inventory_snapshot') && localSearch.includes('resources_state')],
  ['desktop search prefers local runtime', searchApi.includes('global_local_search') && searchApi.includes('LOCAL_SEARCH_TYPES')],
  ['desktop search includes local finance transactions', searchApi.includes("'transactions'") && localSearch.includes('transactions_state') && localSearch.includes('"transaction"')],
  ['local finance runtime exists', localFinance.includes('create_local_transaction') && localFinance.includes('create_local_budget_period') && localFinance.includes('create_local_funding_source')],
  ['finance mutations queue sync changes', localFinance.includes('sync_outbox') && localFinance.includes('entity_type,entity_id,operation,payload_json')],
  ['desktop finance APIs prefer local runtime', financeApi.includes('invoke') && financeApi.includes('create_local_transaction') && financeApi.includes('create_local_budget_period') && financeApi.includes('create_local_funding_source')],
  ['server syncs experiment measurements', sync.includes('project_experiment_measurement') && sync.includes('project_experiment_measurements')],
  ['server syncs experiment observations', sync.includes('project_experiment_observation') && sync.includes('project_experiment_observations')],
  ['project pull includes experiment work data', sync.includes('measurementMap') && sync.includes('observationMap')],
  ['local experiment work commands are registered', tauriMain.includes('create_local_project_experiment_measurement') && tauriMain.includes('create_local_project_experiment_observation')],
  ['server accepts offline location records', sync.includes("change.entity_type==='location'") && sync.includes('applyLocationEntity')],
  ['server exposes location pull', sync.includes("router.get('/locations/pull'") && sync.includes('deleted_location_ids')],
  ['local location mutations queue sync changes', localLocations.includes("'location'") && localLocations.includes('sync_outbox')],
  ['local location counts derive from inventory snapshot', localLocations.includes("inventory_snapshot") && localLocations.includes('item_count') && localLocations.includes('inventory_counts')],
  ['local location detail includes derived item count', localLocations.includes('get_local_location') && localLocations.includes('counts.get(&id)')],
  ['inventory item state has one local source of truth', localInventory.includes('getLocalInventorySnapshot') && localInventory.includes('saveSnapshotWithSync') && !localInventory.includes('local_inventory_items') && !localInventory.includes('upsert_local_inventory_item') && !localInventory.includes('adjust_local_inventory')],
  ['SKU item lookup is offline-capable', itemsApi.includes('getItemBySku') && itemsApi.includes('getLocalInventorySnapshot') && itemsApi.includes("String(i.sku||'')")],
  ['local location pull preserves pending edits', localLocations.includes("entity_type='location'") && localLocations.includes('pending')],
  ['desktop pulls location records', desktopSync.includes('/sync/locations/pull') && desktopSync.includes('apply_server_location_pull')],
  ['Tauri registers location pull merge command', tauriMain.includes('local_locations::apply_server_location_pull')],
  ['server exposes finance pull', sync.includes("router.get('/finance/pull'") && sync.includes('deleted_budget_period')],
  ['server accepts offline finance records', sync.includes('applyFinanceEntity') && sync.includes('FINANCE_CONFIG')],
  ['desktop pulls finance records', desktopSync.includes('/sync/finance/pull') && desktopSync.includes('apply_server_finance_pull')],
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

assert(sync.includes("project_work_attachment"), 'project attachment sync config is missing');
assert(sync.includes("project_work_attachments"), 'project attachment pull is missing');
assert(localProjects.includes('create_local_project_attachment'), 'local project attachment command is missing');
assert(projectsApi.includes("create_local_project_attachment"), 'desktop project attachment API is not local-first');

assert(sync.includes("project_work_attachment"), 'project attachment tombstones are missing');
assert(sync.includes("attachments"), 'project attachment pull mapping is missing');
assert(localProjects.includes('deleted_project_attachment_ids'), 'local attachment tombstone merge is missing');
assert(syncApi.includes('deletedProjectAttachmentIds'), 'desktop attachment tombstones are not passed to local pull');

assert(sync.includes('project_task_experiment'), 'task/experiment sync config is missing');
assert(sync.includes('project_task_experiments'), 'task/experiment pull is missing');
assert(localProjects.includes('create_local_project_task_experiment'), 'local task/experiment command is missing');
assert(projectsApi.includes('create_local_project_task_experiment'), 'desktop task/experiment API is not local-first');

assert(localAuth.includes('bootstrap_local_admin'), 'local admin bootstrap command is missing');
assert(localAuth.includes('local_login'), 'local login command is missing');
assert(authApi.includes('bootstrap_local_admin'), 'desktop registration is not local-first');
assert(authApi.includes('local_login'), 'desktop login is not local-first');
