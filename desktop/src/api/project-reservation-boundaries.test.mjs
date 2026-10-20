import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function load(invoke,{desktop=true,signedIn=true}={}) {
  let generation=0,requests=0;const exports={};
  const source=ts.transpileModule(readFileSync(new URL('./projects.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText;
  vm.runInNewContext(source,{exports,window:desktop?{__TAURI_IPC__:true}:{},require:name=>{
    if(name==='@tauri-apps/api/tauri')return{invoke};
    if(name==='./auth')return{
      captureAccountSession:()=>signedIn?{accountId:'a',generation}:null,
      isAccountSessionCurrent:s=>!!s&&signedIn&&s.generation===generation
    };
    if(name==='./http')return{apiFetch:async()=>{requests++;return{ok:true,json:async()=>[{id:'server'}]}}};
    if(name==='./items'||name==='./transactions')return{};
    throw Error(name);
  }});
  return{api:exports,requests:()=>requests,switchAccount:()=>generation++};
}
test('desktop reservations read the native projection without an HTTP refresh',async()=>{
  const c=load(async(command,args)=>{assert.equal(command,'get_local_project');assert.equal(args.projectId,'p');return{reservations:[{id:'local',quantity:4,local_pending_issue_quantity:2}]}});
  assert.equal((await c.api.getProjectReservations('p'))[0].quantity,4);assert.equal(c.requests(),0);
});
test('missing, rejected and old native snapshots never fall through to HTTP',async()=>{
  for(const mode of ['missing','reject','old']){
    const c=load(async()=>{if(mode==='reject')throw Error('lease expired');return mode==='missing'?null:{id:'p'}});
    await assert.rejects(c.api.getProjectReservations('p'));assert.equal(c.requests(),0);
  }
});
test('native confirmed empty reservations are distinct from an unavailable snapshot',async()=>{
  const c=load(async()=>({reservations:[]}));assert.equal((await c.api.getProjectReservations('p')).length,0);assert.equal(c.requests(),0);
});
test('account switches suppress late reservation results and absent login avoids IPC',async()=>{
  let c;c=load(async()=>{c.switchAccount();return{reservations:[{id:'old-account'}]}});
  await assert.rejects(c.api.getProjectReservations('p'),/Account changed/);assert.equal(c.requests(),0);
  let calls=0;const absent=load(async()=>{calls++},{signedIn:false});
  await assert.rejects(absent.api.getProjectReservations('p'),/Sign in/);assert.equal(calls,0);
});
test('web reservations retain their existing HTTP read path',async()=>{
  const c=load(async()=>{throw Error('Unexpected IPC')},{desktop:false});
  assert.equal((await c.api.getProjectReservations('p'))[0].id,'server');assert.equal(c.requests(),1);
});
