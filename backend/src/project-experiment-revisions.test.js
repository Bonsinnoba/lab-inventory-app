import test from 'node:test';
import assert from 'node:assert/strict';
import {readExperimentRevisionSnapshot} from './project-experiment-revisions.js';

test('revision snapshot parameterizes the authorized scope and propagates rows',async()=>{
  const ids=['00000000-0000-0000-0000-000000000001'];
  const rows=[{id:'revision',experiment_id:'experiment',revision_no:2}];
  const result=await readExperimentRevisionSnapshot({query:async(sql,args)=>{
    assert.deepEqual(args,[ids]);
    assert.match(sql,/WHERE e.project_id=ANY\(\$1::uuid\[\]\)/);
    assert.match(sql,/JOIN project_experiments/);
    assert.match(sql,/revision_no DESC/);
    return {rows};
  }},ids);
  assert.deepEqual(result,rows);
});
test('an empty authorized scope stays empty and query failures do not become empty history',async()=>{
  assert.deepEqual(await readExperimentRevisionSnapshot({query:async(sql,args)=>{
    assert.deepEqual(args,[[]]);return {rows:[]};
  }},[]),[]);
  await assert.rejects(readExperimentRevisionSnapshot({query:async()=>{throw Error('database unavailable');}},[]),/database unavailable/);
});
