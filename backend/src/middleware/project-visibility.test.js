import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveProjectAccess } from './project-access.js';

const access = readFileSync(new URL('./project-access.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../routes/projects.js', import.meta.url), 'utf8');
const sync = readFileSync(new URL('../routes/sync.js', import.meta.url), 'utf8');
const localProjects = readFileSync(new URL('../../../desktop/src-tauri/src/local_projects.rs', import.meta.url), 'utf8');

test('project access applies the shared visibility rule before membership access', () => {
  assert.match(access, /p\.visibility/);
  assert.match(access, /canReadEntity\(\{/);
  assert.match(access, /entityType: 'project'/);
  assert.match(access, /if \(!readable\) return \{ access: 'none'/);
});

test('project routes scope list results and offer audited grant administration', () => {
  assert.match(routes, /visibilityReadSql\(\{alias:'p',entityType:'project'/);
  const financialSummary = routes.match(/router\.get\('\/financial-summary'[\s\S]*?router\.get\('\/reservations\/review-queue'/)?.[0];
  assert.ok(financialSummary, 'financial summary route must exist');
  assert.match(financialSummary, /visibilityReadSql\(\{alias:'p',entityType:'project'/);
  assert.match(financialSummary, /JOIN projects p ON p\.id=pfs\.project_id/);
  assert.match(routes, /router\.put\('\/:id\/visibility'/);
  assert.match(routes, /router\.get\('\/:id\/access-grants'/);
  assert.match(routes, /project_access_grant/);
  assert.match(routes, /canManageEntityGrants/);
});

test('project sync carries scope and reconciles the authorized snapshot', () => {
  assert.match(sync, /project: \{ table: 'projects', fields: \[.*'visibility'/);
  assert.match(sync, /visible_project_ids:ids/);
  assert.match(sync, /INVALID_PROJECT_VISIBILITY/);
  assert.match(localProjects, /visible_project_ids: Vec<String>/);
  assert.match(localProjects, /visible\.contains\(id\)/);
});

test('restricted project editing requires both membership and an edit grant', () => {
  const base = {ownerId:'owner',memberRole:'member',visibility:'restricted',userId:'member',role:'researcher',canEdit:true};
  assert.equal(effectiveProjectAccess({...base,grantLevel:'view'}).access,'view');
  assert.equal(effectiveProjectAccess({...base,grantLevel:'edit'}).access,'edit');
  assert.equal(effectiveProjectAccess({...base,memberRole:null,grantLevel:'edit'}).access,'view');
  assert.equal(effectiveProjectAccess({...base,memberRole:'observer',grantLevel:'edit'}).access,'view');
  assert.equal(effectiveProjectAccess({...base,memberRole:'member',grantLevel:'edit',canEdit:false}).access,'view');
  assert.equal(effectiveProjectAccess({...base,memberRole:'member',grantLevel:'edit',role:'viewer'}).access,'view');
  assert.equal(effectiveProjectAccess({...base,memberRole:null,grantLevel:null,role:'admin'}).access,'admin');
});
