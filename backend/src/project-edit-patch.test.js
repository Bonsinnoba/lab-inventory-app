import test from 'node:test';
import assert from 'node:assert/strict';
import {projectEditPatch} from './project-edit-patch.js';
test('ordinary edits omit unchanged finance and stale unrelated values',()=>{
 const before={description:'old',budget:'100.00',status:'active',due_date:'2026-10-29T00:00:00Z'};
 const record={...before,description:'authored',budget:100,due_date:'2026-10-29'};
 const current={...before,budget:200,status:'on_hold'};
 const patch=projectEditPatch(record,before,current);
 assert.deepEqual(patch,{description:'authored'});assert.equal(record.budget,100);
});
test('conflicting authored fields reject; matching values and independent edits converge',()=>{
 assert.throws(()=>projectEditPatch({description:'mine'},{description:'old'},{description:'theirs'}),{code:'PROJECT_EDIT_CONFLICT'});
 assert.deepEqual(projectEditPatch({description:'mine'},{description:'old'},{description:'mine'}),{description:'mine'});
 assert.deepEqual(projectEditPatch({budget:200},{budget:'100.00'},{budget:100}),{budget:200});
});
test('legacy events without before retain their existing behavior',()=>{
 assert.deepEqual(projectEditPatch({description:'legacy'},null,{}),{description:'legacy'});
});
