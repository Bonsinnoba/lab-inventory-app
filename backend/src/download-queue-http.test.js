import test from 'node:test';
import assert from 'node:assert/strict';
import {queueHttpPayload,sameQueueReceipt} from './download-queue-http.js';
const id='11111111-1111-4111-8111-111111111111',key='22222222-2222-4222-8222-222222222222';
test('enqueue canonicalizes UUID, defaults and schedule before binding the receipt',()=>{
  assert.deepEqual(queueHttpPayload({resource_id:id.replaceAll('-','').toUpperCase()}),{resource_id:id,quality:null,scheduled_for:null,priority:0});
  assert.equal(queueHttpPayload({resource_id:id,scheduled_for:'2026-10-14T13:00:00+01:00'}).scheduled_for,'2026-10-14T12:00:00.000Z');
});
test('malformed enqueue requests fail before writes',()=>{
  for(const body of [null,[],{resource_id:'wrong'},{resource_id:id,quality:'4k'},{resource_id:id,priority:101},{resource_id:id,priority:1.5},{resource_id:id,scheduled_for:'invalid'},{resource_id:id,requested_by:'other'},{resource_id:id,scheduled_for:3}])assert.throws(()=>queueHttpPayload(body),e=>e.status===400);
});
test('receipt replay binds owner, namespace, operation, requested identity and normalized intent',()=>{
  const payload=queueHttpPayload({resource_id:id}),prior={user_id:'owner',device_id:'download-queue-http',entity_type:'resource_download_job',entity_id:key,operation:'create',payload_json:payload};
  assert.equal(sameQueueReceipt(prior,key,{...payload},'owner'),true);
  for(const field of ['user_id','device_id','entity_type','entity_id','operation'])assert.equal(sameQueueReceipt({...prior,[field]:'other'},key,payload,'owner'),false);
  for(const field of ['resource_id','quality','scheduled_for','priority'])assert.equal(sameQueueReceipt(prior,key,{...payload,[field]:'changed'},'owner'),false);
  assert.equal(sameQueueReceipt({...prior,payload_json:{...payload,extra:true}},key,payload,'owner'),false);
});
