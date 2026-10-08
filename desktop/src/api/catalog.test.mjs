import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load(desktop,invoke,fetch){
  let account='a';const exports={};
  const js=ts.transpileModule(readFileSync(new URL('./catalog.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{exports,crypto:{randomUUID},require:p=>{
    if(p==='./local-backend')return{localBackend:{isAvailable:()=>desktop,invoke}};
    if(p==='./auth')return{captureAccountSession:()=>({accountId:account}),isAccountSessionCurrent:s=>s.accountId===account};
    if(p==='./http')return{apiFetch:fetch,getApiErrorMessage:async()=> 'rejected'};throw Error(p);
  }});return {api:exports,switchAccount:()=>{account='b'}};
}
for(const fault of ['null','reject'])test(`catalog ${fault} IPC never falls back to HTTP`,async()=>{
  let requests=0;const {api}=load(true,async()=>{if(fault==='reject')throw Error('disk failed');return null},async()=>{requests++;});
  for(const kind of ['supplier','storage_container']){
    await assert.rejects(api.listCatalog(kind));
    for(const op of ['create','update','delete'])await assert.rejects(api.mutateCatalog(kind,op,{name:'one'},randomUUID(),1));
  }assert.equal(requests,0);
});
test('catalog browser lost acknowledgement retains key and entity ID',async()=>{
  const requests=[];const {api}=load(false,null,async(path,options)=>{requests.push({path,...options});if(requests.length===1)throw Error('lost ACK');return{ok:true,json:async()=>({id:JSON.parse(options.body).id,sync_version:1})}});
  await assert.rejects(api.mutateCatalog('storage_container','create',{name:'one'}));
  await api.mutateCatalog('storage_container','create',{name:'one'});
  assert.equal(requests[0].body,requests[1].body);assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
});
test('catalog edits require captured version and refuse account-switch results',async()=>{
  let requests=0;let client;
  client=load(true,async()=>{requests++;client.switchAccount();return{id:'one'}},async()=>{throw Error('HTTP must not run')});
  await assert.rejects(client.api.mutateCatalog('supplier','delete',{},'one'));assert.equal(requests,0);
  await assert.rejects(client.api.mutateCatalog('supplier','create',{name:'one'}),/Account changed/);
});
