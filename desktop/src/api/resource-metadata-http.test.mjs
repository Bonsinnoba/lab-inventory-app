import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load(){
 const storage=new Map(),calls=[],exports={};let generation=1,owner='alice',desktop=false,mode='ok',counter=0;
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./resource-metadata-http.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,window:{get __TAURI_IPC__(){return desktop;}},crypto:{randomUUID:()=>`id-${++counter}`},sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},require:path=>{
  if(path==='./auth')return{captureAccountSession:()=>({accountId:owner,token:'online',generation}),isAccountSessionCurrent:session=>session.accountId===owner&&session.generation===generation};
  if(path==='./http')return{getApiErrorMessage:async()=> 'HTTP failed',apiFetch:async(path,init)=>{
   if(!init){calls.push({path});return{ok:mode!=='read-denied',json:async()=>({id:'r',kind:'file',description:'reviewed',updated_at:'2026-11-06T01:00:00Z'})};}
   const body=JSON.parse(init.body);calls.push({path,body});if(mode==='lost')throw Error('Response lost');
   const change=body.changes[0];return{ok:true,json:async()=>{
    if(mode==='switch')generation++;
    if(mode==='reject')return{results:[{change_id:change.change_id,status:'rejected',error:{message:'Reviewed revision conflict'}}]};
    return{results:[{change_id:mode==='foreign'?'foreign':change.change_id,status:'synced',result:{acknowledged:true}}]};
   }};
  }};
  throw Error(path);
 }});
 return{api:exports,calls,setMode:value=>{mode=value;},switchOwner:()=>{owner='bob';generation++;},desktop:()=>{desktop=true;}};
}
const revision='2026-11-06T00:00:00Z';
test('metadata browser writes use reviewed canonical sync handler; lost-response retry retains identity',async()=>{
 const c=load();c.setMode('lost');await assert.rejects(c.api.writeResourceMetadataHttp('r',{description:'reviewed'},revision),/Response lost/);
 c.setMode('ok');const result=await c.api.writeResourceMetadataHttp('r',{description:'reviewed'},revision);
 assert.equal(result.description,'reviewed');assert.deepEqual(c.calls[0],c.calls[1]);
 assert.equal(c.calls[0].path,'/sync/push');assert.equal(c.calls[0].body.changes[0].operation,'edit_metadata');assert.equal(c.calls[0].body.changes[0].payload.metadata.expected_updated_at,revision);
 assert.equal(c.calls[2].path,'/resources/r');
 await c.api.writeResourceMetadataHttp('r',{description:'reviewed'},revision);assert.notEqual(c.calls[3].body.changes[0].change_id,c.calls[1].body.changes[0].change_id);
});
test('metadata rejects desktop entry and missing reviewed revision without network writes',async()=>{
 const c=load();await assert.rejects(c.api.writeResourceMetadataHttp('r',{},''),/Refresh and review/);c.desktop();await assert.rejects(c.api.writeResourceMetadataHttp('r',{},revision),/SQLite and the outbox/);assert.equal(c.calls.length,0);
});
test('metadata discards late account confirmations and rejects foreign receipts',async()=>{
 for(const mode of ['switch','foreign']){const c=load();c.setMode(mode);await assert.rejects(c.api.writeResourceMetadataHttp('r',{},revision),/Account changed|not confirmed/);}
 const c=load();c.setMode('lost');await assert.rejects(c.api.writeResourceMetadataHttp('r',{},revision));c.switchOwner();c.setMode('ok');await c.api.writeResourceMetadataHttp('r',{},revision);assert.notEqual(c.calls[0].body.changes[0].change_id,c.calls[1].body.changes[0].change_id);
});
test('definitive revision rejection preserves the error and releases the unsuccessful retry identity',async()=>{
 const c=load();c.setMode('reject');await assert.rejects(c.api.writeResourceMetadataHttp('r',{},revision),/Reviewed revision conflict/);c.setMode('ok');await c.api.writeResourceMetadataHttp('r',{},revision);assert.notEqual(c.calls[0].body.changes[0].change_id,c.calls[1].body.changes[0].change_id);
});
test('a receipt never substitutes for an authorized read; failed post-save refresh retries the same committed intent',async()=>{
 const c=load();c.setMode('read-denied');await assert.rejects(c.api.writeResourceMetadataHttp('r',{},revision),/Details were saved/);c.setMode('ok');await c.api.writeResourceMetadataHttp('r',{},revision);assert.deepEqual(c.calls[0],c.calls[2]);assert.equal(c.calls[1].path,'/resources/r');
});
