import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {syncResponseProjection} from '../sync-receipts.js';

const source = readFileSync(new URL('./sync.js', import.meta.url), 'utf8');

test('engineering pull applies record visibility and returns a cache reconciliation snapshot', () => {
  const pull = source.slice(source.indexOf("router.get('/engineering/pull'"), source.indexOf("router.get('/projects/pull'"));
  assert.match(pull, /visibilityReadSql\(\{alias:'c',entityType:'engineering_calculation'/);
  assert.match(pull, /visibilityReadSql\(\{alias:'t',entityType:'engineering_test'/);
  assert.match(pull, /getProjectAccess\(row\.project_id,req\.user\)/);
  assert.match(pull, /visible_calculation_ids:calc\.map\(row=>row\.id\)/);
  assert.match(pull, /visible_test_ids:tst\.map\(row=>row\.id\)/);
  assert.match(pull, /sync_tombstones[\s\S]*?AND \$1='admin'/);
});

test('engineering and knowledge sync writes authorize existing server rows', () => {
  const engineering = source.slice(source.indexOf('async function applyEngineeringEntity'), source.indexOf("router.get('/notes/pull'"));
  const knowledge = source.slice(source.indexOf('async function applyKnowledgeEntity'), source.indexOf('async function applyChange'));
  for (const handler of [engineering, knowledge]) {
    assert.match(handler, /current\.project_id&&\!\(await canEditProject\(client,current\.project_id,user\)\)/);
    assert.match(handler, /canEditRestrictedEntity\(/);
    assert.match(handler, /ID_COLLISION/);
  }
  assert.match(knowledge, /canReadRelationshipEndpoint\(record\.source_type,record\.source_id,user,client\)/);
  assert.match(knowledge, /canReadKnowledgeRelationship\(current,user,client\)/);
});

test('sync acknowledgements do not replay stale record snapshots after revocation', () => {
  const historical={id:'restricted',project_id:'private-project',content:'private historical content',quarantine_status:'released'};
  for(const entity of ['engineering_calculation','engineering_test','knowledge_note','salvage_recovery']){
    assert.deepEqual(syncResponseProjection(entity,historical,new Set()),{acknowledged:true});
    assert.deepEqual(syncResponseProjection(entity,historical,new Set(['resources.edit'])),{acknowledged:true});
  }
  assert.match(source, /syncResponseProjection\(entityType,prior\.rows\[0\]\.response_json,permissions\)/);
});
