import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load(options={}){
 const exports={},calls=[];let current=true;
 const local={all:[{id:'local',type:'note',title:'Saved'}],total:1};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./search.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URLSearchParams,window:{__TAURI_IPC__:options.desktop!==false},require:name=>{
  if(name==='./auth')return{captureAccountSession:()=>options.signedOut?null:{accountId:'owner'},isAccountSessionCurrent:()=>current};
  if(name==='@tauri-apps/api/tauri')return{invoke:async()=>{calls.push('native');if(options.nativeFail)throw Error('SQLite unavailable');if(options.switchNative)current=false;return local;}};
  if(name==='./http')return{apiFetch:async()=>{calls.push('http');if(options.switchHttp)current=false;if(options.httpFail)throw Error('Server unavailable');return{ok:true,json:async()=>({all:[{id:'remote',type:'user'}]})};}};
  throw Error(name);
 }});return{api:exports,calls};
}
test('desktop search surfaces native failure without an HTTP fallback',async()=>{
 const c=load({nativeFail:true});await assert.rejects(c.api.globalSearch('data'),/SQLite unavailable/);assert.deepEqual(c.calls,['native']);
});
test('local-only desktop search does not wait for central search',async()=>{
 const c=load();assert.equal((await c.api.globalSearch('data',['notes'])).all[0].id,'local');assert.deepEqual(c.calls,['native']);
});
test('note/search data cannot cross account changes, including failed central enrichment',async()=>{
 for(const options of [{switchNative:true},{switchHttp:true},{switchHttp:true,httpFail:true}]){
  const c=load(options);await assert.rejects(c.api.globalSearch('data'),/Account changed/);
 }
 const absent=load({signedOut:true});await assert.rejects(absent.api.globalSearch('data'),/Sign in/);assert.equal(absent.calls.length,0);
});
test('an unavailable explicitly central search retains the current authorized local results',async()=>{
 const c=load({httpFail:true});assert.equal((await c.api.globalSearch('data')).all[0].id,'local');assert.deepEqual(c.calls,['native','http']);
});
test('browser search keeps its explicit server transport',async()=>{
 const c=load({desktop:false});assert.equal((await c.api.globalSearch('data')).all[0].id,'remote');assert.deepEqual(c.calls,['http']);
});
