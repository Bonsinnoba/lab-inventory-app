import test from 'node:test';
import assert from 'node:assert/strict';
import { metadataFields,metadataRevision,metadataExpectedRevision } from './resource-metadata.js';

const id='11111111-1111-4111-8111-111111111111',previous='22222222-2222-4222-8222-222222222222';
const revision='2026-10-14T12:00:00.000Z',change={change_id:'33333333-3333-4333-8333-333333333333',entity_id:id,__device_id:'device'},user={userId:'author'};
const intent=fields=>({protocol:1,expected_updated_at:revision,fields});
test('metadata is an explicit patch, preserving unspecified fields and accepting deliberate clears',()=>{
  assert.deepEqual(metadataFields(intent({description:''})),{description:''});
  assert.deepEqual(metadataFields(intent({tags:[]})),{tags:[]});
  assert.deepEqual(metadataFields(intent({category:'reference',tags:['lab']})),{category:'reference',tags:['lab']});
  assert.deepEqual(metadataFields(intent({})),{});
});
test('metadata cannot change permissions, identity, file bytes or attachment scope',()=>{
  for(const key of ['id','visibility','project_id','note_id','parent_resource_id','storage_path','size_bytes','updated_at','name']){
    assert.throws(()=>metadataFields(intent({[key]:'injected'})),e=>e.code==='INVALID_RESOURCE_METADATA');
  }
  for(const fields of [null,[],{category:'invalid'},{description:null},{description:'x'.repeat(5001)},{tags:['']},{tags:[42]},{tags:['x'.repeat(257)]},{tags:Array(31).fill('tag')}])assert.throws(()=>metadataFields(intent(fields)),e=>e.status===400);
  for(const patch of [{protocol:2},{extra:true},{expected_updated_at:null}])assert.throws(()=>metadataFields({...intent({}),...patch}),e=>e.status===400);
  // Count Unicode code points consistently with the native Rust writer.
  metadataFields(intent({description:'🔬'.repeat(5000),tags:['🔬'.repeat(256)]}));
});
test('metadata revision guard rejects stale or invalid state',()=>{
  metadataRevision(new Date(revision),revision);
  assert.throws(()=>metadataRevision('2026-10-14T12:00:00.001Z',revision),e=>e.code==='RESOURCE_METADATA_CONFLICT');
  assert.throws(()=>metadataRevision(revision,'invalid'),e=>e.status===409);
});
test('metadata uses exact owned move/metadata/file predecessors without changing the intent',async()=>{
  const request={...intent({description:'saved'}),previous_change_id:previous},before=JSON.stringify(request);
  for(const [operation,kind] of [['attach','file'],['edit_metadata','folder'],['edit_metadata','link'],['edit_content','file']]){
    const receipt={change_id:previous,user_id:user.userId,device_id:'device',entity_type:'resource',entity_id:id,operation,response_json:{id,kind,updated_at:'2026-10-14T12:00:00.001Z'}};
    assert.equal(await metadataExpectedRevision({query:async()=>({rows:[receipt]})},request,change,user),receipt.response_json.updated_at);
    await assert.rejects(()=>metadataExpectedRevision({query:async()=>({rows:[{...receipt,user_id:'other'}]})},request,change,user),e=>e.status===409);
  }
  assert.equal(JSON.stringify(request),before);
  await assert.rejects(()=>metadataExpectedRevision({query:async()=>({rows:[]})},request,change,user),e=>e.status===503);
  await assert.rejects(()=>metadataExpectedRevision({}, {...request,previous_change_id:change.change_id},change,user),e=>e.status===400);
  assert.equal(await metadataExpectedRevision({query:()=>assert.fail('unexpected receipt query')},intent({}),change,user),revision);
});
