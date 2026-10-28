import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readExperimentHistorySnapshot} from './project-experiment-history.js';

test('audit-history query contract uses only authorized projects and stable audit ordering',async()=>{
 const ids=['00000000-0000-4000-8000-000000000001'];
 const rows=[{id:'audit',experiment_id:'experiment',action:'UPDATE'}];
 const actual=await readExperimentHistorySnapshot({query:async(sql,args)=>{
  assert.deepEqual(args,[ids]);
  assert.match(sql,/WHERE e.project_id=ANY\(\$1::uuid\[\]\)/);
  assert.match(sql,/a.entity_type='project_experiment'/);
  assert.match(sql,/a.entity_id::text=e.id::text/);
  assert.match(sql,/a.created_at DESC,a.id DESC/);
  assert.doesNotMatch(sql,/project_experiment_revisions|LIMIT/i);
  return{rows};
 }},ids);
 assert.deepEqual(actual,rows);
});
test('empty scope avoids querying and failed history is not replaced with empty history',async()=>{
 const db={query:async()=>{throw Error('Unavailable')}};
 assert.deepEqual(await readExperimentHistorySnapshot(db,[]),[]);
 await assert.rejects(readExperimentHistorySnapshot(db,['project']),/Unavailable/);
});
test('project pull attaches audit history separately from saved revisions',()=>{
 const source=readFileSync(new URL('./routes/sync.js',import.meta.url),'utf8');
 assert.match(source,/readExperimentHistorySnapshot\(pool,ids\)/);
 assert.match(source,/const historyMap=by\(history,'experiment_id'\)/);
 assert.match(source,/e.history=historyMap.get\(e.id\)\|\|\[\]/);
 assert.match(source,/e.revisions=revisionMap.get\(e.id\)\|\|\[\]/);
});
