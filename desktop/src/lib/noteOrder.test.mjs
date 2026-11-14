import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./noteOrder.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
test('new notes lead, edits to old notes do not displace them, ties are deterministic and input is preserved',()=>{
 const notes=[{id:'old',created_at:'2026-10-01T10:00:00Z',updated_at:'2026-12-01T00:00:00Z'},{id:'new',created_at:'2026-11-06T12:00:00+02:00',updated_at:''},{id:'a',created_at:'bad',updated_at:''},{id:'b',created_at:'',updated_at:''}];
 const before=JSON.stringify(notes);assert.deepEqual(Array.from(exports.newestNotesFirst(notes),n=>n.id),['new','old','a','b']);assert.equal(JSON.stringify(notes),before);
});
