import test from 'node:test';
import assert from 'node:assert/strict';
import {authorityIds,resourceScope,resourceAuthority,resourceBindings,inheritedResourceAuthority} from './resource-authority.js';
const id='aaffbbcc-0011-4233-8455-66778899aabb';
const row={id,updated_at:'2026-10-14T00:00:00.000Z',visibility:'restricted',project_id:null,item_id:null,note_id:null,parent_resource_id:null};
test('authority request UUIDs are canonical, unique and bounded',()=>{
  assert.deepEqual(authorityIds([id.toUpperCase()]),[id]);
  for(const input of [null,{},['bad'],[id,id.toUpperCase()],Array(101).fill(id)])assert.throws(()=>authorityIds(input),e=>e.status===400);
  assert.deepEqual(authorityIds([]),[]);
});
test('authorized stable resource emits only scoped edit authority, not content or grants for another ID',()=>{
  const grant=resourceAuthority(id,row,{...row,description:'private'},true);
  assert.deepEqual(grant,{resource_id:id,can_edit:true,revision:row.updated_at,scope:resourceScope(row)});
  assert.equal(resourceAuthority(id,{...row,id:'other'},row,true).can_edit,false);
});
test('denials and deleted resources reveal no scope and never inherit prior authority',()=>{
  for(const [before,after,allowed] of [[row,row,false],[null,row,true],[row,null,true]])
    assert.deepEqual(resourceAuthority(id,before,after,allowed),{resource_id:id,can_edit:false,revision:null,scope:null});
});
test('concurrent revision or attachment changes fail closed',()=>{
  for(const patch of [{updated_at:'invalid'},{updated_at:'2026-10-14T00:00:01.000Z'},{visibility:'lab'},{project_id:id},{note_id:id},{parent_resource_id:id},{item_id:id}])
    assert.equal(resourceAuthority(id,row,{...row,...patch},true).can_edit,false);
});

const folder='baffbbcc-0011-4233-8455-66778899aabb',note='caffbbcc-0011-4233-8455-66778899aabb';
const chain=()=>[
  {...row,kind:'file',depth:0,parent_resource_id:folder},
  {...row,id:folder,kind:'folder',depth:1,note_id:note,resolved_note_id:note,note_project_id:null,note_visibility:'restricted'},
];
test('inherited grants bind the complete folder and note scope without disclosing content',()=>{
  const rows=chain(),grant=inheritedResourceAuthority(id,rows[0],rows[0],true,rows,rows);
  assert.equal(grant.can_edit,true);
  assert.equal(grant.bindings.length,2);
  assert.deepEqual(grant.bindings[1].note,{id:note,project_id:null,visibility:'restricted'});
  assert.equal(JSON.stringify(grant).includes('uploaded_by'),false);
});
test('incomplete, cyclic, non-folder, multi-parent and unresolved note chains deny',()=>{
  const cases=[[],chain().slice(0,1),chain().concat(chain()[0])];
  for(const patch of [{parent_resource_id:id},{kind:'file'},{resolved_note_id:null},{project_id:id},{depth:8}]){
    const rows=chain();Object.assign(rows[1],patch);cases.push(rows);
  }
  for(const rows of cases)assert.equal(resourceBindings(rows),null);
});
test('ancestor changes during authority evaluation return a metadata-free denial',()=>{
  for(const patch of [{visibility:'lab'},{note_visibility:'lab'},{note_project_id:folder},{note_id:null}]){
    const before=chain(),after=chain();Object.assign(after[1],patch);
    assert.deepEqual(inheritedResourceAuthority(id,before[0],after[0],true,before,after),{resource_id:id,can_edit:false,revision:null,scope:null,bindings:null});
  }
});
test('chain depth is bounded without accepting a truncated root',()=>{
  const rows=Array.from({length:32},(_,depth)=>({...row,id:`node-${depth}`,kind:'folder',depth,parent_resource_id:depth<31?`node-${depth+1}`:null}));
  assert.equal(resourceBindings(rows).length,32);
  rows[31].parent_resource_id='node-32';assert.equal(resourceBindings(rows),null);
  rows.push({...row,id:'node-32',kind:'folder',depth:32});assert.equal(resourceBindings(rows),null);
});
