import test from 'node:test';
import assert from 'node:assert/strict';
import {experimentObservationProjection,assertExperimentObservationText} from './project-experiment-observations.js';
test('projection preserves prose and child rows with legacy reader compatibility',()=>{
  const row={id:'e',observations:'The sample changed colour.'},records=[{id:'o',content:'red'}];
  const result=experimentObservationProjection(row,records);
  assert.equal(row.observations,'The sample changed colour.');
  assert.equal(result.observations_text,row.observations);
  assert.deepEqual(result.observation_records,records);assert.deepEqual(result.observations,records);
});
test('blank prose and empty collections stay distinct',()=>{
  const result=experimentObservationProjection({observations:''},[]);
  assert.equal(result.observations_text,'');assert.deepEqual(result.observation_records,[]);
});
test('legacy ambiguous payloads are rejected without mutation',()=>{
  for(const observations of [[],[{content:'saved'}],null,{}]){
    const record={observations},before=JSON.stringify(record);
    assert.throws(()=>assertExperimentObservationText(record),{code:'EXPERIMENT_OBSERVATIONS_UNAVAILABLE'});
    assert.equal(JSON.stringify(record),before);
  }
  assert.throws(()=>assertExperimentObservationText({observations:'',observations_text_available:false}),{code:'EXPERIMENT_OBSERVATIONS_UNAVAILABLE'});
  assert.doesNotThrow(()=>assertExperimentObservationText({observations:'real text'}));
  assert.doesNotThrow(()=>assertExperimentObservationText({title:'partial patch'}));
});
