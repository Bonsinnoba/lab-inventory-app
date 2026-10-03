import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const access = readFileSync(new URL('./resource-access.js', import.meta.url), 'utf8');
const sync = readFileSync(new URL('../routes/sync.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../routes/resources.js', import.meta.url), 'utf8');
const localResources = readFileSync(new URL('../../../desktop/src-tauri/src/local_resources.rs', import.meta.url), 'utf8');

test('resource access evaluates every ancestor and attached Note scope', () => {
  assert.match(access, /rc\.visibility/);
  assert.match(access, /n\.visibility AS note_visibility/);
  assert.match(access, /for \(const row of context\.resources\)/);
  assert.match(access, /entityType: 'resource'/);
  assert.match(access, /entityType: 'note'/);
  assert.match(access, /canEditRestrictedEntity\(\{ entityType: 'resource'/);
  assert.match(access, /canEditRestrictedEntity\(\{ entityType: 'note'/);
});

test('resource sync and desktop reconciliation use the authorized snapshot', () => {
  assert.match(sync, /RESOURCE_FIELDS=.*'visibility'/);
  assert.match(sync, /visible_resource_ids:visible\.map\(row=>row\.id\)/);
  assert.match(sync, /INVALID_RESOURCE_VISIBILITY/);
  assert.match(localResources, /visible_resource_ids: Vec<String>/);
  assert.match(localResources, /visible\.contains\(&id\)/);
});

test('restricted resources have server-side scope and grant administration routes', () => {
  assert.match(routes, /router\.put\('\/:id\/visibility'/);
  assert.match(routes, /router\.get\('\/:id\/access-grants'/);
  assert.match(routes, /router\.put\('\/:id\/access-grants\/:userId'/);
  assert.match(routes, /canManageEntityGrants/);
  assert.match(routes, /record_access_grants/);
  assert.match(routes, /resource_access_grant/);
});

test('resource metadata facets use the same effective access as resource reads', () => {
  assert.match(routes, /async function visibleResourceFacetRows\(user\)/);
  assert.match(routes, /getResourceAccess\(row\.id, user\)/);
  assert.match(routes, /router\.get\('\/meta\/tags'[\s\S]*?visibleResourceFacetRows\(req\.user\)/);
  assert.match(routes, /router\.get\('\/meta\/categories'[\s\S]*?visibleResourceFacetRows\(req\.user\)/);
});
