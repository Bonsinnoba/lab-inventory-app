import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentDestination, checkAttachmentRevision } from './resource-attachment.js';

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
