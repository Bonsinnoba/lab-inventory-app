import test from 'node:test';
import assert from 'node:assert/strict';
import { destinationRequests, destinationAuthority } from './resource-destination-authority.js';
const id='aa112233-4455-4677-8899-aabbccddeeff',project='bb112233-4455-4677-8899-aabbccddeeff';
test('destination requests are bounded, canonical, typed and duplicate-safe',()=>{
  assert.deepEqual(destinationRequests([{kind:'note',id:id.toUpperCase()}]),[{kind:'note',id}]);
  for(const input of [null,{},Array(26).fill({kind:'note',id}),[{kind:'folder',id}],[{kind:'note',id:'bad'}],[{kind:'note',id,can_attach:true}],[{kind:'note',id},{kind:'note',id:id.toUpperCase()}]])assert.throws(()=>destinationRequests(input),e=>e.status===400);
  assert.equal(destinationRequests([{kind:'note',id},{kind:'project',id}]).length,2);
});
test('note destination authority binds scope, not editable note contents',()=>{
  const request={kind:'note',id},row={id,project_id:project,visibility:'restricted'};
  assert.deepEqual(destinationAuthority(request,row,{...row,body:'changed'},true),{...request,can_attach:true,scope:{project_id:project,visibility:'restricted'}});
  for(const after of [null,{...row,id:project},{...row,project_id:null},{...row,visibility:'lab'}])assert.deepEqual(destinationAuthority(request,row,after,true),{...request,can_attach:false,scope:null});
});
test('project grants are identity-bound and denied destinations disclose no scope',()=>{
  const request={kind:'project',id},row={id,visibility:'project'};
  assert.deepEqual(destinationAuthority(request,row,row,true),{...request,can_attach:true,scope:{project_id:id,visibility:'project'}});
  for(const [before,after,allowed] of [[null,row,true],[row,row,false],[row,null,true]])assert.deepEqual(destinationAuthority(request,before,after,allowed),{...request,can_attach:false,scope:null});
});
