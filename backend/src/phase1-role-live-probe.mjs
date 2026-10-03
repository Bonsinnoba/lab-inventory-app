// Runs only inside the existing API container. Creates and removes one isolated
// researcher/project/record set; never changes a pre-existing account or row.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { pool } from './db.js';

if (process.env.LABOS_PHASE1_ROLE_PROBE !== '1') throw new Error('Set LABOS_PHASE1_ROLE_PROBE=1');

const marker = `LABOS-PHASE1-ROLE-${randomUUID()}`;
const ids = { user: randomUUID(), project: randomUUID(), calculation: randomUUID(), finding: randomUUID(), note: randomUUID(), relationship: randomUUID() };
const changeIds = [];
const deviceId = randomUUID();

async function request(method, path, body) {
  const token = jwt.sign({ userId: ids.user }, config.jwtSecret, { expiresIn: '5m' });
  const response = await fetch(`http://127.0.0.1:4000/api${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function push(entityType, entityId, operation, record) {
  const changeId = randomUUID();
  changeIds.push(changeId);
  const response = await request('POST', '/sync/push', {
    device_id: deviceId,
    changes: [{ change_id: changeId, entity_type: entityType, entity_id: entityId, operation, payload: { record } }],
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.results[0];
}

async function grant(entityType, entityId, level) {
  await pool.query(
    `INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level)
     VALUES($1,$2,$3,$4) ON CONFLICT(entity_type,entity_id,user_id)
     DO UPDATE SET access_level=EXCLUDED.access_level`,
    [entityType, entityId, ids.user, level],
  );
}

try {
  const admin = await pool.query("SELECT id FROM users WHERE username='balika' AND role='admin' AND is_active=true");
  assert.equal(admin.rowCount, 1, 'active balika administrator is required');
  await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'probe-not-a-login','researcher')", [ids.user, marker]);
  await pool.query('INSERT INTO projects(id,name,owner_id) VALUES($1,$2,$3)', [ids.project, marker, admin.rows[0].id]);
  await pool.query('INSERT INTO project_members(project_id,user_id,member_role) VALUES($1,$2,$3)', [ids.project, ids.user, 'member']);
  await pool.query("INSERT INTO engineering_calculations(id,project_id,title,formula,result_numeric,visibility) VALUES($1,$2,$3,'ohms_law',2,'restricted')", [ids.calculation, ids.project, marker]);
  await pool.query("INSERT INTO lab_findings(id,project_id,title,visibility) VALUES($1,$2,$3,'restricted')", [ids.finding, ids.project, marker]);
  await pool.query('INSERT INTO notes(id,title,project_id) VALUES($1,$2,$3)', [ids.note, marker, ids.project]);

  await grant('engineering_calculation', ids.calculation, 'view');
  const calcRecord = { id: ids.calculation, project_id: null, title: `${marker}-edited` };
  assert.equal((await push('engineering_calculation', ids.calculation, 'update', calcRecord)).error.code, 'RECORD_ACCESS_DENIED');
  await grant('engineering_calculation', ids.calculation, 'edit');
  assert.equal((await push('engineering_calculation', ids.calculation, 'update', calcRecord)).status, 'synced');
  assert.equal((await pool.query('SELECT project_id FROM engineering_calculations WHERE id=$1', [ids.calculation])).rows[0].project_id, ids.project);

  await grant('finding', ids.finding, 'view');
  const findingRecord = { id: ids.finding, project_id: null, title: `${marker}-edited` };
  assert.equal((await push('finding', ids.finding, 'update', findingRecord)).error.code, 'RECORD_ACCESS_DENIED');
  await grant('finding', ids.finding, 'edit');
  assert.equal((await push('finding', ids.finding, 'update', findingRecord)).status, 'synced');
  assert.equal((await pool.query('SELECT project_id FROM lab_findings WHERE id=$1', [ids.finding])).rows[0].project_id, ids.project);

  await pool.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2', [ids.project, ids.user]);
  assert.equal((await push('engineering_calculation', ids.calculation, 'update', calcRecord)).error.code, 'PROJECT_ACCESS_DENIED');
  assert.equal((await push('finding', ids.finding, 'update', findingRecord)).error.code, 'PROJECT_ACCESS_DENIED');
  await pool.query("INSERT INTO project_members(project_id,user_id,member_role) VALUES($1,$2,'member')", [ids.project, ids.user]);

  const relationshipRecord = { id: ids.relationship, project_id: ids.project, source_type: 'finding', source_id: ids.finding, target_type: 'note', target_id: ids.note, relationship: 'supports' };
  await pool.query("DELETE FROM record_access_grants WHERE entity_type='finding' AND entity_id=$1 AND user_id=$2", [ids.finding, ids.user]);
  assert.equal((await push('knowledge_relationship', ids.relationship, 'create', relationshipRecord)).error.code, 'RELATIONSHIP_ENDPOINT_DENIED');
  await grant('finding', ids.finding, 'view');
  assert.equal((await push('knowledge_relationship', ids.relationship, 'create', relationshipRecord)).status, 'synced');
  await pool.query("DELETE FROM record_access_grants WHERE entity_type='finding' AND entity_id=$1 AND user_id=$2", [ids.finding, ids.user]);
  assert.equal((await push('knowledge_relationship', ids.relationship, 'delete', { id: ids.relationship })).error.code, 'RELATIONSHIP_ENDPOINT_DENIED');

  await pool.query('UPDATE users SET is_active=false WHERE id=$1', [ids.user]);
  assert.equal((await request('GET', '/knowledge/sync/pull')).status, 401);
  console.log('Phase 1 role probe: view/edit grants, stored-project checks, relationship endpoints and disabled account passed');
} finally {
  if (changeIds.length) await pool.query('DELETE FROM sync_idempotency WHERE change_id=ANY($1::text[])', [changeIds]);
  await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1', [ids.user]);
  await pool.query('DELETE FROM knowledge_relationships WHERE id=$1', [ids.relationship]);
  await pool.query('DELETE FROM record_access_grants WHERE user_id=$1 AND entity_id=ANY($2::uuid[])', [ids.user, [ids.calculation, ids.finding, ids.note]]);
  await pool.query('DELETE FROM engineering_calculations WHERE id=$1', [ids.calculation]);
  await pool.query('DELETE FROM lab_findings WHERE id=$1', [ids.finding]);
  await pool.query('DELETE FROM notes WHERE id=$1', [ids.note]);
  await pool.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2', [ids.project, ids.user]);
  await pool.query('DELETE FROM projects WHERE id=$1 AND name=$2', [ids.project, marker]);
  await pool.query('DELETE FROM users WHERE id=$1 AND username=$2', [ids.user, marker]);
  await pool.end();
}
