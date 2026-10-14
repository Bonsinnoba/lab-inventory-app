import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentDestination, checkAttachmentRevision, attachmentPredecessor, attachmentExpectedRevision } from './resource-attachment.js';

const id='aa112233-4455-6677-8899-aabbccddeeff';
test('attachment destination canonicalizes UUIDs and makes detaching explicit',()=>{
  assert.deepEqual(attachmentDestination({project_id:id.toUpperCase()}),{item_id:null,project_id:id,note_id:null});
  assert.deepEqual(attachmentDestination({}),{item_id:null,project_id:null,note_id:null});
});
test('attachment cannot inject fields, folders, malformed IDs or multiple parents',()=>{
  for(const value of [null,[],{project_id:'x'},{note_id:id,item_id:id},{parent_resource_id:id},{visibility:'lab'},{item_id:7}])
    assert.throws(()=>attachmentDestination(value),e=>e.code==='INVALID_ATTACHMENT');
});
test('stale or missing revisions cannot silently overwrite newer resource state',()=>{
  const resource={updated_at:new Date('2026-10-12T12:00:00.123Z')};
  checkAttachmentRevision(resource,'2026-10-12T12:00:00.123Z');
  assert.throws(()=>checkAttachmentRevision(resource,'2026-10-12T12:00:00.122Z'),e=>e.status===409);
  for(const value of [null,undefined,0,'invalid'])assert.throws(()=>checkAttachmentRevision(resource,value),e=>e.status===400);
});

const previous='bb112233-4455-4677-8899-aabbccddeeff',change={change_id:'cc112233-4455-4677-8899-aabbccddeeff',entity_id:id,__device_id:'device'},user={userId:'author'};
test('attachment dependencies require explicit protocol and cannot reference themselves',()=>{
  assert.equal(attachmentPredecessor({protocol:1},change,user),null);
  assert.equal(attachmentPredecessor({protocol:2,previous_change_id:previous.toUpperCase()},change,user),previous);
  for(const move of [{protocol:0},{protocol:1,previous_change_id:previous},{protocol:2,previous_change_id:'bad'},{protocol:2,previous_change_id:change.change_id}])assert.throws(()=>attachmentPredecessor(move,change,user),e=>e.status===400);
  assert.throws(()=>attachmentPredecessor({protocol:2,previous_change_id:previous},{...change,__device_id:null},user),e=>e.status===400);
});
test('attachment after a saved file edit resolves the original receipt without rewriting its intent',async()=>{
  const move={protocol:2,previous_change_id:previous,expected_updated_at:'local-revision'},before=JSON.stringify(move);
  const receipt={user_id:user.userId,device_id:'device',entity_type:'resource',entity_id:id,operation:'edit_content',response_json:{id,kind:'file',updated_at:'2026-10-14T12:00:00.000Z'}};
  const client={query:async(sql,args)=>{assert.match(sql,/sync_idempotency/);assert.deepEqual(args,[previous]);return {rows:[receipt]};}};
  assert.equal(await attachmentExpectedRevision(client,move,change,user),receipt.response_json.updated_at);
  assert.equal(JSON.stringify(move),before);
  const noQuery={query:()=>assert.fail('legacy move must not query a predecessor')};
  assert.equal(await attachmentExpectedRevision(noQuery,{protocol:1,expected_updated_at:'confirmed'},change,user),'confirmed');
});
test('missing attachment predecessor waits; foreign and metadata receipts cannot authorize the move',async()=>{
  const move={protocol:2,previous_change_id:previous};
  await assert.rejects(()=>attachmentExpectedRevision({query:async()=>({rows:[]})},move,change,user),e=>e.status===503);
  const base={user_id:user.userId,device_id:'device',entity_type:'resource',entity_id:id,operation:'edit_content',response_json:{id,kind:'file',updated_at:'2026-10-14T12:00:00.000Z'}};
  for(const patch of [{user_id:'other'},{device_id:'other'},{entity_id:previous},{operation:'attach'},{operation:'update'},{response_json:{id,kind:'file'}}])await assert.rejects(()=>attachmentExpectedRevision({query:async()=>({rows:[{...base,...patch}]})},move,change,user),e=>e.status===409);
});
