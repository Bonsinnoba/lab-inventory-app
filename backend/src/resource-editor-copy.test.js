import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePdfCopy, validateEditorCopy, copyRevision } from './resource-editor-copy.js';
const source={id:'source',kind:'file',file_type:'pdf',original_filename:'report.PDF',visibility:'restricted',project_id:'project',updated_at:'2026-10-12T07:00:00.000Z'};
const record={id:'copy',kind:'file',file_type:'pdf',mime_type:'application/pdf',visibility:'restricted',project_id:'project',derived_from_resource_id:'source'};
const descriptor={protocol:1,source_id:'source',source_updated_at:source.updated_at};
const docxSource={...source,file_type:'document',original_filename:'report.DOCX'};
const docxRecord={...record,file_type:'document',original_filename:'Edited.docx',mime_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',size_bytes:1000};
const docxDescriptor={...descriptor,format:'docx'};
const previous='11111111-1111-4111-8111-111111111111';
const intent={change_id:'22222222-2222-4222-8222-222222222222',__device_id:'device'};
const author={userId:'author'};
const receipt={user_id:'author',device_id:'device',entity_type:'resource',entity_id:'source',operation:'create',response_json:{id:'source',kind:'file',updated_at:'2026-10-13T07:00:00.000Z'}};
test('copy resolves an unsynced source through its own create/copy/edit receipt without mutating the intent',()=>{
  const offline={...descriptor,previous_change_id:previous};
  for(const operation of ['create','create_copy','edit_content']){
    const revision=copyRevision(offline,{...receipt,operation},intent,author);
    validateEditorCopy({...source,updated_at:receipt.response_json.updated_at},record,{...offline,source_updated_at:revision});
  }
  assert.equal(offline.source_updated_at,source.updated_at);
  assert.equal(copyRevision(descriptor,null,intent,author),source.updated_at);
});
test('missing copy predecessor retries; foreign or stale receipts cannot authorize a copy',()=>{
  const offline={...descriptor,previous_change_id:previous};
  assert.throws(()=>copyRevision(offline,null,intent,author),e=>e.status===503&&e.code==='RESOURCE_EDIT_DEPENDENCY_PENDING');
  for(const delta of [{user_id:'other'},{device_id:'other'},{entity_type:'note'},{entity_id:'other'},{operation:'delete'},{response_json:{...receipt.response_json,id:'other'}}])
    assert.throws(()=>copyRevision(offline,{...receipt,...delta},intent,author),e=>e.status===409);
  const resolved=copyRevision(offline,receipt,intent,author);
  assert.throws(()=>validateEditorCopy({...source,updated_at:'2026-10-13T08:00:00.000Z'},record,{...offline,source_updated_at:resolved}),e=>e.status===409);
});
test('copy predecessor rejects malformed IDs, self references and missing sync authentication',()=>{
  for(const id of ['',true,{},'bad',intent.change_id,intent.change_id.toUpperCase()])
    assert.throws(()=>copyRevision({...descriptor,previous_change_id:id},receipt,intent,author),e=>e.code==='INVALID_EDITOR_COPY');
  assert.throws(()=>copyRevision({...descriptor,previous_change_id:previous},receipt,{},author),e=>e.code==='INVALID_EDITOR_COPY');
});
test('DOCX copies require explicit format and retain source scope and revision',()=>{
  validateEditorCopy(docxSource,docxRecord,docxDescriptor);
  assert.throws(()=>validateEditorCopy(docxSource,docxRecord,descriptor),e=>e.code==='INVALID_EDITOR_COPY');
  for(const delta of [{format:'html'},{protocol:2},{source_id:'other'}])
    assert.throws(()=>validateEditorCopy(docxSource,docxRecord,{...docxDescriptor,...delta}),e=>e.code==='INVALID_EDITOR_COPY');
  for(const delta of [{size_bytes:0},{size_bytes:16*1024*1024+1},{size_bytes:'1000'},{original_filename:'fake.pdf'},{mime_type:'text/html'},{file_type:'pdf'}])
    assert.throws(()=>validateEditorCopy(docxSource,{...docxRecord,...delta},docxDescriptor),e=>e.code==='INVALID_EDITOR_COPY');
});
test('DOCX copy cannot change scope, reuse source identity or overwrite a newer source',()=>{
  for(const delta of [{visibility:'lab'},{project_id:null},{note_id:'note'},{parent_resource_id:'folder'}])
    assert.throws(()=>validateEditorCopy(docxSource,{...docxRecord,...delta},docxDescriptor),e=>e.code==='EDITOR_COPY_SCOPE_CHANGED');
  assert.throws(()=>validateEditorCopy(docxSource,{...docxRecord,id:source.id},docxDescriptor),e=>e.code==='INVALID_EDITOR_COPY');
  assert.throws(()=>validateEditorCopy(docxSource,docxRecord,{...docxDescriptor,source_updated_at:'2026-10-11T07:00:00.000Z'}),e=>e.status===409);
});
test('PDF copy retains source identity, scope, visibility and confirmed revision',()=>{
  validatePdfCopy(source,record,descriptor);
  assert.equal(source.id,'source');assert.equal(record.id,'copy');
});
test('PDF copy rejects identity forgery and unsupported formats',()=>{
  for(const delta of [{id:'source'},{derived_from_resource_id:'other'},{kind:'link'},{file_type:'text'},{mime_type:'text/html'}])
    assert.throws(()=>validatePdfCopy(source,{...record,...delta},descriptor),e=>e.code==='INVALID_EDITOR_COPY');
  assert.throws(()=>validatePdfCopy(source,record,{...descriptor,protocol:2}),e=>e.code==='INVALID_EDITOR_COPY');
  assert.throws(()=>validatePdfCopy({...source,file_type:'document'},record,descriptor),e=>e.code==='INVALID_EDITOR_COPY');
});
test('PDF copy cannot silently lower visibility, move context or use a stale source',()=>{
  for(const delta of [{visibility:'lab'},{project_id:null},{note_id:'note'},{parent_resource_id:'folder'}])
    assert.throws(()=>validatePdfCopy(source,{...record,...delta},descriptor),e=>e.code==='EDITOR_COPY_SCOPE_CHANGED');
  assert.throws(()=>validatePdfCopy(source,record,{...descriptor,source_updated_at:'2026-10-11T07:00:00.000Z'}),e=>e.status===409);
});
