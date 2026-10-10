import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load(desktop,invoke,fetch){let account='a';const exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./notifications.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto:{randomUUID},require:p=>{
    if(p==='./local-backend')return{localBackend:{isAvailable:()=>desktop,invoke}};
    if(p==='./auth')return{captureAccountSession:()=>({accountId:account}),isAccountSessionCurrent:s=>s.accountId===account};
    if(p==='./http')return{apiFetch:fetch,getApiErrorMessage:async()=> 'rejected'};throw Error(p);
  }});return{api:exports,switchAccount:()=>{account='b'}};
}
for(const failure of ['null','reject'])test(`notifications ${failure} IPC never falls back to HTTP`,async()=>{
  let requests=0;const {api}=load(true,async()=>{if(failure==='reject')throw Error('disk failed');return null},async()=>{requests++;});
  await assert.rejects(api.listNotifications());await assert.rejects(api.markNotificationsRead([randomUUID()]));assert.equal(requests,0);
});
test('read-all retries freeze original IDs despite later arrivals',async()=>{
  const a=randomUUID(),b=randomUUID(),calls=[];let lists=0;
  const {api}=load(false,null,async(path,options)=>{
    if(!options?.method){lists++;return{ok:true,json:async()=>({snapshot_complete:true,records:[{id:a,read_at:null},...(lists>1?[{id:b,read_at:null}]:[])]})}}
    calls.push(options);if(calls.length===1)throw Error('lost ACK');return{ok:true,json:async()=>({ok:true,updated:1})};
  });
  await assert.rejects(api.markAllVisibleNotificationsRead());await api.markAllVisibleNotificationsRead();
  assert.equal(lists,1);assert.deepEqual(JSON.parse(calls[1].body).ids,[a]);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
});
