import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePdfCopy } from './resource-editor-copy.js';
const source={id:'source',kind:'file',file_type:'pdf',original_filename:'report.PDF',visibility:'restricted',project_id:'project',updated_at:'2026-10-12T07:00:00.000Z'};
const record={id:'copy',kind:'file',file_type:'pdf',mime_type:'application/pdf',visibility:'restricted',project_id:'project',derived_from_resource_id:'source'};
const descriptor={protocol:1,source_id:'source',source_updated_at:source.updated_at};
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
