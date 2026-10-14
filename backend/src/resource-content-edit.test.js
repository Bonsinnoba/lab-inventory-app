import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMarkdownEdit,validateContentEdit,validatePdfHeader,predecessorRevision,assertEditRevision} from './resource-content-edit.js';
const source={id:'document',kind:'file',file_type:'text',original_filename:'notes.MD'};
const record={id:'document',kind:'file',size_bytes:10};
const edit={protocol:1,expected_updated_at:'2026-10-12T09:00:00.000Z',previous_change_id:null};

test('Markdown edits keep the existing identity and permit empty UTF-8 documents',()=>{
  validateMarkdownEdit(source,record,edit);
  validateMarkdownEdit(source,{...record,size_bytes:0},edit);
  validateMarkdownEdit(source,record,{...edit,previous_change_id:'11111111-1111-4111-8111-111111111111'});
});
test('unsupported formats, identity changes and malformed version chains are rejected',()=>{
  for(const delta of [{id:'other'},{kind:'link'}])assert.throws(()=>validateMarkdownEdit(source,{...record,...delta},edit),e=>e.code==='INVALID_RESOURCE_EDIT');
  for(const delta of [{file_type:'document'},{original_filename:'notes.html'}])assert.throws(()=>validateMarkdownEdit({...source,...delta},record,edit),e=>e.code==='INVALID_RESOURCE_EDIT');
  for(const delta of [{protocol:2},{expected_updated_at:null},{expected_updated_at:'bad'},{previous_change_id:'bad'}])assert.throws(()=>validateMarkdownEdit(source,record,{...edit,...delta}),e=>e.code==='INVALID_RESOURCE_EDIT');
});
test('editor byte bounds reject oversized, negative and fractional lengths',()=>{
  for(const size_bytes of [-1,0.5,4*1024*1024+1,NaN,'10'])assert.throws(()=>validateMarkdownEdit(source,{...record,size_bytes},edit),e=>e.status===413);
});
test('revision guard accepts equivalent timestamps but rejects stale and invalid versions',()=>{
  assertEditRevision(new Date(edit.expected_updated_at),edit.expected_updated_at);
  assertEditRevision(edit.expected_updated_at,'2026-10-12T10:00:00.000+01:00');
  for(const revision of ['2026-10-12T09:00:00.001Z','invalid'])assert.throws(()=>assertEditRevision(revision,edit.expected_updated_at),e=>e.code==='RESOURCE_EDIT_CONFLICT');
});

test('PDF replacement requires the existing PDF identity and explicit format',()=>{
  const pdf={...source,file_type:'pdf',original_filename:'Original.PDF'};
  assert.equal(validateContentEdit(pdf,record,{...edit,format:'pdf'}),'pdf');
  for(const delta of [{format:'docx'},{format:'markdown'}])assert.throws(()=>validateContentEdit(pdf,record,{...edit,...delta}),e=>e.code==='INVALID_RESOURCE_EDIT');
  assert.throws(()=>validateContentEdit(source,record,{...edit,format:'pdf'}),e=>e.code==='INVALID_RESOURCE_EDIT');
  for(const size_bytes of [0,4,500*1024*1024+1])assert.throws(()=>validateContentEdit(pdf,{...record,size_bytes},{...edit,format:'pdf'}),e=>e.status===413);
});
test('PDF signature checks are byte-exact, not extension/MIME or masked ASCII checks',()=>{
  validatePdfHeader(Buffer.from('%PDF-'));
  for(const header of [Buffer.from('hello'),Buffer.from('%PDF'),Buffer.from([0xa5,0xd0,0xc4,0xc6,0xad]),'%PDF-'])assert.throws(()=>validatePdfHeader(header),e=>e.code==='RESOURCE_EDIT_ENCODING');
});

test('offline edits can follow their own pending file creation, copy or prior edit',()=>{
  const prior={user_id:'author',device_id:'device',entity_type:'resource',entity_id:'document',response_json:{id:'document',kind:'file',updated_at:edit.expected_updated_at}};
  for(const operation of ['create','create_copy','edit_content'])assert.equal(predecessorRevision({...prior,operation},{__device_id:'device'},{userId:'author'},'document'),edit.expected_updated_at);
});
test('predecessors cannot cross account, device, entity or operation boundaries',()=>{
  const prior={user_id:'author',device_id:'device',entity_type:'resource',entity_id:'document',operation:'edit_content',response_json:{id:'document',kind:'file',updated_at:edit.expected_updated_at}};
  for(const delta of [{user_id:'other'},{device_id:'other'},{entity_id:'other'},{entity_type:'note'},{operation:'delete'},{response_json:{id:'other',kind:'file',updated_at:edit.expected_updated_at}},{response_json:{id:'document',kind:'file',updated_at:'invalid'}}])assert.throws(()=>predecessorRevision({...prior,...delta},{__device_id:'device'},{userId:'author'},'document'),e=>e.code==='RESOURCE_EDIT_CONFLICT');
  assert.throws(()=>predecessorRevision(null,{__device_id:'device'},{userId:'author'},'document'),e=>e.status===503);
});
