import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const resources = read('src/routes/resources.js');
const sync = read('src/routes/sync.js');
const localResources = read('../desktop/src-tauri/src/local_resources.rs');
const migration = read('src/migrations/043_resource_link_duplicate_constraint.sql');

const checks = [
  ['server direct link creation normalizes trailing slashes', resources.includes("const normalizedUrl=String(url).trim().replace(/\\/+$/,'')")],
  ['server direct link creation serializes duplicate checks with a transaction advisory lock', resources.includes('pg_advisory_xact_lock') && resources.includes('lockResourceLink(client,normalizedUrl,parents)') && resources.includes("client.query('BEGIN')")],
  ['server direct duplicate scope includes item/project/note/folder parents', resources.includes('item_id IS NOT DISTINCT FROM $2') && resources.includes('project_id IS NOT DISTINCT FROM $3') && resources.includes('note_id IS NOT DISTINCT FROM $4') && resources.includes('parent_resource_id IS NOT DISTINCT FROM $5')],
  ['server sync link creation uses the same advisory-lock primitive', sync.includes('pg_advisory_xact_lock') && sync.includes('lockResourceLink(client,record)')],
  ['server sync duplicate scope includes all resource parents', sync.includes('item_id IS NOT DISTINCT FROM $2') && sync.includes('project_id IS NOT DISTINCT FROM $3') && sync.includes('note_id IS NOT DISTINCT FROM $4') && sync.includes('parent_resource_id IS NOT DISTINCT FROM $5')],
  ['server sync returns the existing logical link instead of inserting a second row', /if\(duplicate\.rowCount\)return duplicate\.rows\[0\]/.test(sync)],
  ['local resource creation normalizes URLs before duplicate comparison', localResources.includes('normalize_resource_url') && localResources.includes('let normalized_url = normalize_resource_url(&url)')],
  ['local resource duplicate comparison includes all parent scopes', localResources.includes('r.item_id == item_id && r.project_id == project_id && r.note_id == note_id && r.parent_resource_id == parent_resource_id')],
  ['local duplicate reuse prefers the copy with local media', localResources.includes('max_by_key(|r| if r.local_media_path.is_some() { 1 } else { 0 })')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`RESOURCE DEDUP STATIC TESTS FAILED: ${checks.length - failed}/${checks.length}`);
  process.exit(1);
}
console.log(`RESOURCE DEDUP STATIC TESTS PASSED: ${checks.length}/${checks.length}`);
