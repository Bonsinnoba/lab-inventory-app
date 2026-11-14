import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const transpile=file=>ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const ordering={};vm.runInNewContext(transpile('../lib/noteOrder.ts'),{exports:ordering});
function load(desktop,fail=false,switchDuringRead=false,signedIn=true){
 let current=true;
 const exports={},calls=[],rows=[{id:'old',created_at:'2026-01-01',updated_at:'2026-12-01'},{id:'new',created_at:'2026-11-06',updated_at:'2026-11-06'}];
 vm.runInNewContext(transpile('./notes.ts'),{exports,URLSearchParams,window:{__TAURI_IPC__:desktop},require:path=>{
  if(path==='../lib/noteOrder')return ordering;
  if(path==='./auth')return{captureAccountSession:()=>signedIn?{accountId:'owner',generation:0}:null,isAccountSessionCurrent:()=>current};
  if(path==='@tauri-apps/api/tauri')return{invoke:async(command,args)=>{calls.push({command,args});if(fail)throw Error('SQLite unavailable');if(switchDuringRead)current=false;return rows;}};
  if(path==='./http')return{apiFetch:async path=>{calls.push({path});return{ok:true,json:async()=>rows};}};
  throw Error(path);
 }});return{api:exports,calls,rows};
}
test('desktop and browser notes use the same newest-created-first order without rewriting source records',async()=>{
 for(const desktop of [true,false]){const c=load(desktop),before=JSON.stringify(c.rows);assert.deepEqual(Array.from(await c.api.getNotes({project_id:'p'}),row=>row.id),['new','old']);assert.equal(JSON.stringify(c.rows),before);assert.equal(c.calls.length,1);if(desktop)assert.equal(c.calls[0].command,'list_local_notes');else assert.equal(c.calls[0].path,'/notes?project_id=p');}
});
test('ordering does not introduce an HTTP fallback when local notes fail',async()=>{
 const c=load(true,true);await assert.rejects(c.api.getNotes(),/SQLite unavailable/);assert.equal(c.calls.length,1);assert.equal(c.calls[0].command,'list_local_notes');
});
test('background note results cannot cross a session change or run signed out',async()=>{
 const changed=load(true,false,true);await assert.rejects(changed.api.getNotes(),/Account changed/);assert.equal(changed.calls.length,1);
 const absent=load(true,false,false,false);await assert.rejects(absent.api.getNotes(),/Sign in/);assert.equal(absent.calls.length,0);
});
