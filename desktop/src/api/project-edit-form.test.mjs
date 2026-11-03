import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./project-edit-form.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
test('project dates display timestamp days without timezone conversion',()=>{
 for(const date of ['2026-10-29','2026-10-29T00:00:00.000Z','2026-10-29T00:00:00+14:00'])assert.equal(exports.projectInputDate(date),'2026-10-29');
});
test('missing dates stay empty and unrelated edits retain dates and revision',()=>{
 assert.equal(exports.projectInputDate(null),'');assert.equal(exports.projectInputDate(undefined),'');
 const form=exports.projectEditForm({name:'Plan',budget:0,lifecycle_revision:4,start_date:'2026-10-29T00:00:00Z',due_date:null});
 form.description='Offline edit';
 assert.equal(form.start_date,'2026-10-29');assert.equal(form.due_date,'');assert.equal(form.budget,0);assert.equal(form.expected_lifecycle_revision,4);
});
