import test from 'node:test';
import assert from 'node:assert/strict';
import {ownsDownloadAttempt,downloadStopReason,publicationDecision} from './download-worker-state.js';

const attempt={id:'job',resource_id:'resource',worker_run_id:'run-a'};
const current={...attempt,status:'downloading',attempts:1,max_attempts:3};
const resource={kind:'link',url:'https://example.test/video'};
const input={current,attempt,resource,source:resource,media:{name:'attempt.mp4',size:12}};
test('attempt ownership requires matching job, resource, nonempty run and running state',()=>{
  assert.equal(ownsDownloadAttempt(current,attempt),true);
  for(const record of [null,{...current,id:'other'},{...current,resource_id:'other'},{...current,worker_run_id:'run-b'},{...current,status:'completed'},{...current,worker_run_id:null}])assert.equal(ownsDownloadAttempt(record,attempt),false);
  assert.equal(ownsDownloadAttempt(current,{...attempt,worker_run_id:null}),false);
  assert.equal(ownsDownloadAttempt(current,{...attempt,lease_lost:true}),false);
});
test('missing, completed and superseded attempts cannot publish or resume',()=>{
  for(const record of [null,{...current,status:'completed'},{...current,worker_run_id:'run-b'}]){
    assert.equal(downloadStopReason(record,attempt),'superseded');
    assert.deepEqual(publicationDecision({...input,current:record}),{action:'ignore'});
  }
});
test('committed pause or cancellation wins over a completed subprocess',()=>{
  for(const status of ['paused','cancelled']){
    const record={...current,stop_requested_status:status,cancel_requested:true,error_message:'operator request'};
    assert.equal(downloadStopReason(record,attempt),status);
    assert.deepEqual(publicationDecision({...input,current:record}),{action:'stop',status,error:'operator request'});
  }
  assert.equal(downloadStopReason({...current,cancel_requested:true},attempt),'cancelled');
});
test('source deletion, changed URL/type, permission denial and existing media prevent publication',()=>{
  for(const change of [{resource:null},{resource:{...resource,url:'https://example.test/changed'}},{resource:{...resource,kind:'file'}},{denial:'Account disabled'},{resource:{...resource,local_media_path:'already-published.mp4'}}]){
    const result=publicationDecision({...input,...change});assert.equal(result.action,'stop');assert.equal(result.status,'cancelled');assert.ok(result.error);
  }
});
test('retry budget is bounded and missing media is not marked completed',()=>{
  assert.equal(publicationDecision({...input,error:Error('network')}).status,'queued');
  assert.equal(publicationDecision({...input,current:{...current,attempts:3},error:Error('network')}).status,'failed');
  assert.equal(publicationDecision({...input,media:null}).status,'queued');
  for(const media of [{name:'file',size:0},{name:'file',size:NaN},{name:'file',size:-1},{size:1},{}])assert.equal(publicationDecision({...input,media}).action,'stop');
  assert.equal(publicationDecision({...input,error:Error('x'.repeat(3000))}).error.length,2000);
});
test('only current authorized complete media is published; artwork is optional',()=>{
  assert.deepEqual(publicationDecision(input),{action:'publish'});
  assert.equal(downloadStopReason(current,attempt),null);
});
test('decisions do not mutate jobs, source metadata or attempt identities',()=>{
  const before=JSON.stringify(input);publicationDecision(input);downloadStopReason(current,attempt);assert.equal(JSON.stringify(input),before);
});
