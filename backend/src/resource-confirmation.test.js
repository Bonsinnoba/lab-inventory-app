import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmationRequest,confirmationReceipt,confirmationDigest} from './resource-confirmation.js';
const id='11111111-1111-4111-8111-111111111111',change='22222222-2222-4222-8222-222222222222';
const request={change_ids:[change],resource_id:id,device_id:'device'};

test('tree move requires protocol 5 and binds exact root path plus immutable tree payload',()=>{
 const record={id,kind:'folder',name:'Reviewed folder',name_source:'user',relative_path:'Reviewed folder',parent_resource_id:change,updated_at:'2026-11-08T00:00:00.000Z'};
 const payload={id,tree_move:{protocol:1,destination:{parent_resource_id:change},members:[{id}],source_context_sha256:'a'.repeat(64),destination_context_sha256:'b'.repeat(64)}};
 const event={change_id:change,user_id:'author',device_id:'device',entity_type:'resource',entity_id:id,operation:'move_tree',response_json:record,payload_json:payload};
 for(const protocol of [1,2,3,4])assert.equal(confirmationReceipt(change,event,{...request,protocol},'author').confirmed,false);
 const receipt=confirmationReceipt(change,event,{...request,protocol:5},'author');assert.equal(receipt.confirmed,true);assert.equal(receipt.payload_sha256,confirmationDigest(payload));assert.equal(receipt.size_bytes,undefined);
 assert.notEqual(confirmationReceipt(change,{...event,response_json:{...record,relative_path:'Changed'}},{...request,protocol:5},'author').mutation_sha256,receipt.mutation_sha256);
 assert.equal(confirmationReceipt(change,{...event,payload_json:{id,tree_move:{...payload.tree_move,members:[]}}},{...request,protocol:5},'author').confirmed,false);
 assert.equal(confirmationRequest({...request,protocol:5}).protocol,5);
});
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
  for(const protocol of [0,6,'2',null])assert.throws(()=>confirmationRequest({...request,protocol}),e=>e.status===400);
  assert.deepEqual(confirmationRequest({...request,protocol:1}),request);
});

test('mixed-chain protocol binds file bytes and the exact resulting metadata without breaking older shapes',()=>{
  const payload={resource:{id},upload:{protocol:1,size_bytes:12,sha256:'a'.repeat(64)}};
  const v3=confirmationRequest({...request,protocol:3});assert.equal(v3.protocol,3);
  const result=confirmationReceipt(change,{...row,payload_json:payload},v3,'author');
  assert.equal(result.payload_sha256,confirmationDigest(payload));assert.equal(result.size_bytes,12);
  assert.equal(result.mutation_sha256,confirmationDigest({kind:'file',visibility:'lab',item_id:null,project_id:null,note_id:null,parent_resource_id:null,category:null,description:null,tags:[]}));
  assert.equal(confirmationReceipt(change,{...row,payload_json:payload},{...request,protocol:2},'author').mutation_sha256,undefined);
});


test('protocol 4 binds names and provenance and refuses a rename downgrade',()=>{
 const payload={id,metadata:{protocol:1,fields:{name:'Reviewed title'}}};
 const record={...row.response_json,name:'Reviewed title',name_source:'user'};
 const event={...row,operation:'edit_metadata',payload_json:payload,response_json:record};
 assert.equal(confirmationReceipt(change,event,{...request,protocol:3},'author').confirmed,false);
 const result=confirmationReceipt(change,event,{...request,protocol:4},'author');assert.equal(result.confirmed,true);
 const renamed=confirmationReceipt(change,{...event,response_json:{...record,name:'Other title'}},{...request,protocol:4},'author');
 assert.notEqual(renamed.mutation_sha256,result.mutation_sha256);
 const source=confirmationReceipt(change,{...event,response_json:{...record,name_source:'metadata'}},{...request,protocol:4},'author');assert.notEqual(source.mutation_sha256,result.mutation_sha256);
 assert.equal(result.payload_sha256,confirmationDigest(payload));
});

test('new native link and folder creation receipts require their origin marker and mixed protocol',()=>{
 for(const kind of ['link','folder']){
 const record={id,kind,name:'Native title',name_source:'user',updated_at:row.response_json.updated_at};
 const event={...row,operation:'create',response_json:record,payload_json:{resource:record,native_create_protocol:1}};
 for(const protocol of [3,4]){const result=confirmationReceipt(change,event,{...request,protocol},'author');assert.equal(result.confirmed,true);assert.equal(result.size_bytes,undefined);assert.equal(result.payload_sha256,confirmationDigest(event.payload_json));}
 for(const protocol of [1,2])assert.equal(confirmationReceipt(change,event,{...request,protocol},'author').confirmed,false);
 assert.equal(confirmationReceipt(change,{...event,payload_json:{resource:record}},{...request,protocol:3},'author').confirmed,false);
 }
});


test('tree move requires protocol 5 and binds exact root path plus immutable tree payload',()=>{
 const payload={id,tree_move:{protocol:1,members:[{id}],destination:{parent_resource_id:change}}};
 const record={...row.response_json,kind:'folder',name:'Root',name_source:'user',relative_path:'Root',parent_resource_id:change};
 const event={...row,operation:'move_tree',payload_json:payload,response_json:record};
 for(const protocol of [1,2,3,4])assert.deepEqual(confirmationReceipt(change,event,{...request,protocol},'author'),{change_id:change,confirmed:false});
 const receipt=confirmationReceipt(change,event,{...request,protocol:5},'author');assert.equal(receipt.confirmed,true);assert.equal(receipt.payload_sha256,confirmationDigest(payload));assert.equal(receipt.size_bytes,undefined);assert.equal(receipt.storage_path,undefined);
 const projection={kind:'folder',visibility:'lab',item_id:null,project_id:null,note_id:null,parent_resource_id:change,category:null,description:null,tags:[],name:'Root',name_source:'user',relative_path:'Root'};
 assert.equal(receipt.mutation_sha256,confirmationDigest(projection));
 assert.notEqual(confirmationReceipt(change,{...event,response_json:{...record,relative_path:'Other'}},{...request,protocol:5},'author').mutation_sha256,receipt.mutation_sha256);
 for(const patch of [{user_id:'other'},{device_id:'other'},{payload_json:{...payload,tree_move:{protocol:1,members:[]}}}])assert.equal(confirmationReceipt(change,{...event,...patch},{...request,protocol:5},'author').confirmed,false);
});
