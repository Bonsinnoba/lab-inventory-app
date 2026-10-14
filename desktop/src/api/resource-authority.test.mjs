import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load({protocol=1,fail=false,current=true}={}){
  const calls=[],exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./resource-authority.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{
    if(name==='./auth')return {captureServerRequest:async()=>({accountId:'account',nativeSessionToken:'native-session'}),isServerRequestCurrent:()=>current};
    if(name==='@tauri-apps/api/tauri')return {invoke:async(command,args)=>{calls.push({command,args});if(command==='local_database_status')return{resource_authority_protocol:protocol};if(fail)throw Error('native verification failed');}};
    throw Error(name);
  }});return {api:exports,calls};
}
test('authority adapter requests native verification without passing renderer-supplied grants or origin',async()=>{
  const c=load();await c.api.refreshResourceAuthority('token',()=>{});
  assert.equal(c.calls[1].command,'refresh_local_resource_authority');
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls[1].args)),{expectedAccountId:'account',expectedSessionToken:'native-session',serverToken:'token'});
});
test('legacy native binary is not sent an unknown command and gets no grant fallback',async()=>{
  const c=load({protocol:0});await c.api.refreshResourceAuthority('token',()=>{});assert.equal(c.calls.length,1);
});
test('native verification failure and account changes fail closed',async()=>{
  const c=load({fail:true});await assert.rejects(()=>c.api.refreshResourceAuthority('token',()=>{}),/native verification failed/);assert.equal(c.calls.length,2);
  const switched=load({current:false});await assert.rejects(()=>switched.api.refreshResourceAuthority('token',()=>{}),/session unavailable/);assert.equal(switched.calls.length,1);
});

test('sync refreshes authority after note, project and resource pulls and includes its result',()=>{
  const source=readFileSync(new URL('./sync.ts',import.meta.url),'utf8');
  const refresh=source.indexOf("const authorityPullSucceeded=await runPullStep('Resource authority'");
  assert.ok(refresh>0);
  for(const declaration of ['const notesPullSucceeded=','const projectPullSucceeded=','const resourcePullSucceeded='])assert.ok(source.indexOf(declaration)<refresh);
  assert.equal(source.split('await refreshResourceAuthority(').length-1,1);
  assert.match(source,/const pullSucceeded=authorityPullSucceeded&&/);
});
