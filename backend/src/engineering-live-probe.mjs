// Run inside the existing API container. All probe records/grants are removed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { pool } from './db.js';

if (process.env.LABOS_LIVE_ENGINEERING_PROBE !== '1') {
  throw new Error('Set LABOS_LIVE_ENGINEERING_PROBE=1 to run against the configured database');
}

const marker = `LABOS-ENGINEERING-PROBE-${randomUUID()}`;
let calculationId;
let testId;
const syncCalculationId = randomUUID();
const syncDeviceId = randomUUID();
const syncChangeIds = [];

async function request(userId, method, path, body) {
  const token = jwt.sign({ userId }, config.jwtSecret, { expiresIn: '5m' });
  const response = await fetch(`http://127.0.0.1:4000/api${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}

try {
  const users = await pool.query("SELECT id,username,role FROM users WHERE username IN ('balika','testuser') AND is_active=true");
  const admin = users.rows.find(row => row.username === 'balika' && row.role === 'admin');
  const member = users.rows.find(row => row.username === 'testuser' && row.role !== 'admin');
  assert.ok(admin && member, 'active balika admin and non-admin testuser must exist');

  const calculation = await request(admin.id, 'POST', '/engineering/calculations', { title: marker, formula: 'ohms_law', inputs: {current_A:1,resistance_ohm:2}, result_numeric: 2, result_unit: 'V' });
  assert.equal(calculation.status, 201, JSON.stringify(calculation.body));
  calculationId = calculation.body.id;
  const engineeringTest = await request(admin.id, 'POST', '/engineering/tests', { title: marker });
  assert.equal(engineeringTest.status, 201, JSON.stringify(engineeringTest.body));
  testId = engineeringTest.body.id;
  await pool.query("UPDATE engineering_calculations SET visibility='restricted' WHERE id=$1 AND title=$2", [calculationId, marker]);
  await pool.query("UPDATE engineering_tests SET visibility='restricted' WHERE id=$1 AND title=$2", [testId, marker]);

  async function memberVisibility() {
    const [calculations, tests, compare, pull] = await Promise.all([
      request(member.id, 'GET', '/engineering/calculations'),
      request(member.id, 'GET', '/engineering/tests'),
      request(member.id, 'GET', `/engineering/compare?ids=${calculationId}`),
      request(member.id, 'GET', '/sync/engineering/pull'),
    ]);
    for (const response of [calculations, tests, compare, pull]) assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(pull.body.calculations.map(row => row.id).sort(), pull.body.visible_calculation_ids.sort());
    assert.deepEqual(pull.body.tests.map(row => row.id).sort(), pull.body.visible_test_ids.sort());
    return [calculations.body.some(row => row.id === calculationId), tests.body.some(row => row.id === testId), compare.body.some(row => row.id === calculationId), pull.body.calculations.some(row => row.id === calculationId), pull.body.tests.some(row => row.id === testId)];
  }

  assert.deepEqual(await memberVisibility(), [false,false,false,false,false]);
  await pool.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('engineering_calculation',$1,$2,'view',$3),('engineering_test',$4,$2,'view',$3)", [calculationId, member.id, admin.id, testId]);
  assert.deepEqual(await memberVisibility(), [true,true,true,true,true]);
  await pool.query("DELETE FROM record_access_grants WHERE user_id=$1 AND ((entity_type='engineering_calculation' AND entity_id=$2) OR (entity_type='engineering_test' AND entity_id=$3))", [member.id, calculationId, testId]);
  assert.deepEqual(await memberVisibility(), [false,false,false,false,false]);
  const createChangeId = randomUUID();
  syncChangeIds.push(createChangeId);
  const syncRecord = {id:syncCalculationId,title:`${marker}-sync`,formula:'ohms_law',inputs:{current_A:1,resistance_ohm:2},result_numeric:2,result_unit:'V',visibility:'restricted'};
  const syncCreate = {change_id:createChangeId,entity_type:'engineering_calculation',entity_id:syncCalculationId,operation:'create',payload:{record:syncRecord}};
  async function push(change) {
    const response = await request(admin.id,'POST','/sync/push',{device_id:syncDeviceId,changes:[change]});
    assert.equal(response.status,200,JSON.stringify(response.body));
    return response.body.results[0];
  }
  assert.equal((await push(syncCreate)).status,'synced');
  assert.equal((await push(syncCreate)).status,'synced','same change ID should replay idempotently');
  const duplicateChangeId=randomUUID();syncChangeIds.push(duplicateChangeId);
  const duplicate=await push({...syncCreate,change_id:duplicateChangeId});
  assert.equal(duplicate.status,'rejected');
  assert.equal(duplicate.error.code,'ENGINEERING_ID_COLLISION');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM engineering_calculations WHERE id=$1',[syncCalculationId])).rows[0].count,1);
  const memberPull=await request(member.id,'GET','/sync/engineering/pull');
  assert.equal(memberPull.status,200);
  assert.ok(!memberPull.body.visible_calculation_ids.includes(syncCalculationId));
  const creatorGrant=await pool.query("SELECT access_level FROM record_access_grants WHERE entity_type='engineering_calculation' AND entity_id=$1 AND user_id=$2",[syncCalculationId,admin.id]);
  assert.equal(creatorGrant.rows[0]?.access_level,'edit');
  const deleteChangeId=randomUUID();syncChangeIds.push(deleteChangeId);
  const syncDelete={change_id:deleteChangeId,entity_type:'engineering_calculation',entity_id:syncCalculationId,operation:'delete',payload:{record:{id:syncCalculationId}}};
  assert.equal((await push(syncDelete)).status,'synced');
  assert.equal((await push(syncDelete)).status,'synced','delete replay should be idempotent');
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM engineering_calculations WHERE id=$1',[syncCalculationId])).rows[0].count,0);
  console.log('engineering live probe: visibility, grants/revocation, restricted sync create, replay, collision and delete passed');
} finally {
  await pool.query('DELETE FROM engineering_calculations WHERE id=$1 AND title=$2',[syncCalculationId,`${marker}-sync`]);
  await pool.query("DELETE FROM record_access_grants WHERE entity_type='engineering_calculation' AND entity_id=$1",[syncCalculationId]);
  await pool.query("DELETE FROM sync_tombstones WHERE entity_type='engineering_calculation' AND entity_id=$1",[syncCalculationId]);
  if(syncChangeIds.length)await pool.query('DELETE FROM sync_idempotency WHERE change_id=ANY($1::text[])',[syncChangeIds]);
  if (calculationId) await pool.query("DELETE FROM record_access_grants WHERE entity_type='engineering_calculation' AND entity_id=$1", [calculationId]);
  if (testId) await pool.query("DELETE FROM record_access_grants WHERE entity_type='engineering_test' AND entity_id=$1", [testId]);
  if (calculationId) await pool.query('DELETE FROM engineering_calculations WHERE id=$1 AND title=$2', [calculationId, marker]);
  if (testId) await pool.query('DELETE FROM engineering_tests WHERE id=$1 AND title=$2', [testId, marker]);
  await pool.end();
}
