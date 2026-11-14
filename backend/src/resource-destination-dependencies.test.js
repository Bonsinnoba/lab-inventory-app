import test from 'node:test';import assert from 'node:assert/strict';
import {requireResourceDestinationDependencies as requireDependency} from './resource-destination-dependencies.js';
const parent='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',current='33333333-3333-4333-8333-333333333333';
const user={userId:'author'};
function change(kind='project',operation='create'){return{change_id:current,__device_id:'device',operation,payload:{resource:{[`${kind}_id`]:parent},destination_dependencies:[{change_id:id,entity_type:kind,entity_id:parent}]}};}
test('unsynchronized destination is retryable and a matching owned receipt supplies ordering only',async()=>{
 for(const kind of ['project','note']){const c=change(kind);await assert.rejects(requireDependency({query:async()=>({rows:[]})},c,user),e=>e.status===503&&e.code==='RESOURCE_DESTINATION_PENDING');
 await requireDependency({query:async()=>({rows:[{user_id:'author',device_id:'device',entity_type:kind,entity_id:parent,operation:'create',response_status:200,response_json:{id:parent}}]})},c,user);}
});
test('destination dependencies cannot borrow another author, device, entity or non-creation receipt',async()=>{
 const base={user_id:'author',device_id:'device',entity_type:'project',entity_id:parent,operation:'create',response_status:200,response_json:{id:parent}};
 for(const patch of [{user_id:'other'},{device_id:'other'},{entity_type:'note'},{entity_id:current},{operation:'update'},{response_status:500},{response_json:{id:current}}])await assert.rejects(requireDependency({query:async()=>({rows:[{...base,...patch}]})},change(),user),e=>e.status===409);
});
test('malformed, unrelated and self-referential dependencies never run destination mutations',async()=>{
 const noQuery={query:()=>{throw Error('Unexpected query');}};
 for(const edit of [c=>c.payload.destination_dependencies=[],c=>c.payload.destination_dependencies.push({...c.payload.destination_dependencies[0]}),c=>c.payload.destination_dependencies[0].change_id=current,c=>c.payload.resource.project_id=current,c=>c.payload.destination_dependencies[0].grant=true,c=>c.operation='edit_metadata']){const c=change();edit(c);await assert.rejects(requireDependency(noQuery,c,user),e=>e.status===400);}
 await requireDependency(noQuery,{payload:{}},user);
});
