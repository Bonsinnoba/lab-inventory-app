import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmationRequest,confirmationReceipt,confirmationDigest} from './resource-confirmation.js';
const id='11111111-1111-4111-8111-111111111111',change='22222222-2222-4222-8222-222222222222';
const request={change_ids:[change],resource_id:id,device_id:'device'};
test('confirmation digests match the native Unicode fixture and ignore object key insertion order',()=>{
  assert.equal(confirmationDigest({z:['é','😀','\n'],a:{protocol:1,empty:null}}),'9cb97ba7feb7f5caab3d881124865586e18261b9dd323263dd531ed5a7beb544');
  assert.equal(confirmationDigest({a:{empty:null,protocol:1},z:['é','😀','\n']}),confirmationDigest({z:['é','😀','\n'],a:{protocol:1,empty:null}}));
  assert.notEqual(confirmationDigest(['first','second']),confirmationDigest(['second','first']));
});
const row={change_id:change,user_id:'author',device_id:'device',entity_type:'resource',entity_id:id,operation:'edit_content',response_json:{id,kind:'file',updated_at:'2026-10-14T00:00:00.000Z',size_bytes:12,storage_path:'private'}};
test('confirmation requests require bounded identities and a device',()=>{
  assert.deepEqual(confirmationRequest(request),request);
  for(const patch of [{change_ids:[]},{change_ids:Array(101).fill(change)},{change_ids:[change,change]},{resource_id:'bad'},{device_id:''},{device_id:42}])assert.throws(()=>confirmationRequest({...request,...patch}),e=>e.status===400);
});
test('owned file confirmation returns only event identity, revision and size',()=>{
  assert.deepEqual(confirmationReceipt(change,row,request,'author'),{change_id:change,confirmed:true,resource_id:id,operation:'edit_content',revision:row.response_json.updated_at,size_bytes:12});
  assert.equal(confirmationReceipt(change,{...row,response_json:{...row.response_json,size_bytes:'12'}},request,'author').confirmed,true);
});
test('foreign, missing or unsupported events cannot confirm authored work or disclose metadata',()=>{
  const bad=[null,...[{user_id:'other'},{device_id:'other'},{entity_type:'note'},{entity_id:change},{change_id:id},{operation:'delete'}].map(p=>({...row,...p}))];
  for(const value of bad)assert.deepEqual(confirmationReceipt(change,value,request,'author'),{change_id:change,confirmed:false});
});
test('incomplete or invalid historical file results remain unconfirmed',()=>{
  for(const patch of [{id:change},{kind:'folder'},{updated_at:null},{updated_at:'bad'},{size_bytes:null},{size_bytes:-1},{size_bytes:1.5}])assert.deepEqual(confirmationReceipt(change,{...row,response_json:{...row.response_json,...patch}},request,'author'),{change_id:change,confirmed:false});
});

test('owned mutation confirmation binds exact payload and resulting scope/metadata, without storage paths',()=>{
  for(const operation of ['attach','edit_metadata']){
    const payload={id,metadata:{protocol:1,fields:{description:'saved'}}};
    const result=confirmationReceipt(change,{...row,operation,payload_json:payload,response_json:{...row.response_json,visibility:'restricted',description:'saved',tags:['lab']}},request,'author');
    assert.equal(result.confirmed,true);assert.equal(result.operation,operation);assert.equal(result.payload_sha256,confirmationDigest(payload));
    assert.equal(result.mutation_sha256,confirmationDigest({kind:'file',visibility:'restricted',item_id:null,project_id:null,note_id:null,parent_resource_id:null,category:null,description:'saved',tags:['lab']}));
    assert.equal(result.size_bytes,undefined);assert.equal(result.mutation,undefined);assert.equal(result.payload,undefined);
  }
});
test('mutation confirmation cannot disclose foreign or malformed historical work',()=>{
  const mutation={...row,operation:'edit_metadata',payload_json:{id}};
  for(const patch of [{user_id:'other'},{device_id:'other'},{entity_id:change},{payload_json:{id:change}},{response_json:{...row.response_json,updated_at:'bad'}}]){
    assert.deepEqual(confirmationReceipt(change,{...mutation,...patch},request,'author'),{change_id:change,confirmed:false});
  }
});
test('maximum-sized metadata does not expand the mutation receipt',()=>{
  const description='😀'.repeat(5000),tags=Array(30).fill('😀'.repeat(256));
  const result=confirmationReceipt(change,{...row,operation:'edit_metadata',payload_json:{id,metadata:{fields:{description,tags}}},response_json:{...row.response_json,description,tags}},request,'author');
  assert.equal(result.confirmed,true);assert.ok(Buffer.byteLength(JSON.stringify(result))<1024);
});

test('file protocol 2 binds exact committed upload intent without exposing it',()=>{
  const v2=confirmationRequest({...request,protocol:2});
  assert.equal(v2.protocol,2);
  const payload={resource:{id},upload:{protocol:1,size_bytes:12,sha256:'a'.repeat(64)}};
  for(const operation of ['create','create_copy','edit_content']){
    const result=confirmationReceipt(change,{...row,operation,payload_json:payload},v2,'author');
    assert.equal(result.confirmed,true);
    assert.equal(result.payload_sha256,confirmationDigest(payload));
    assert.equal(result.payload,undefined);assert.equal(result.storage_path,undefined);
    assert.notEqual(result.payload_sha256,confirmationDigest({...payload,upload:{...payload.upload,sha256:'b'.repeat(64)}}));
    assert.equal(confirmationReceipt(change,{...row,operation,payload_json:payload},request,'author').payload_sha256,undefined);
  }
});

test('file protocol 2 refuses incomplete or inconsistent historical upload provenance',()=>{
  const payload={resource:{id},upload:{protocol:1,size_bytes:12,sha256:'a'.repeat(64)}};
  const bad=[null,{}, {...payload,resource:{id:change}}, ...[{protocol:2},{size_bytes:13},{size_bytes:'12'},{sha256:'bad'},{sha256:'A'.repeat(64)}].map(p=>({...payload,upload:{...payload.upload,...p}}))];
  for(const payload_json of bad)assert.deepEqual(confirmationReceipt(change,{...row,payload_json},{...request,protocol:2},'author'),{change_id:change,confirmed:false});
  for(const protocol of [0,3,'2',null])assert.throws(()=>confirmationRequest({...request,protocol}),e=>e.status===400);
  assert.deepEqual(confirmationRequest({...request,protocol:1}),request);
});
