import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function load({desktop=true,invoke=async()=>null,fetch=async()=>{throw new Error('HTTP must not run')}}={}){
  const exports={};
  const compiled=ts.transpileModule(readFileSync(new URL('./maintenance.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(compiled,{exports,crypto:{randomUUID},require:dep=>{
    if(dep==='./local-backend')return {localBackend:{isAvailable:()=>desktop,invoke}};
    if(dep==='./auth')return {captureAccountSession:()=>({accountId:'account',token:'token'}),isAccountSessionCurrent:()=>true};
    if(dep==='./http')return {apiFetch:fetch,getApiErrorMessage:async()=> 'rejected'};
    throw new Error(dep);
  }});return exports;
}
for(const fault of ['null','reject'])test(`maintenance ${fault}: no server fallback for any mutation`,async()=>{
  let writes=0;
  const api=load({invoke:async()=>{if(fault==='reject')throw new Error('Disk full');return null},fetch:async()=>{writes++;throw new Error('HTTP')}});
  for(const op of ['create','update','delete'])await assert.rejects(api.mutateMaintenance('item',op,{},'record',1));
  assert.equal(writes,0);
});
test('browser lost response retries preserve identity and idempotency key',async()=>{
  const requests=[];
  const api=load({desktop:false,fetch:async(_path,options)=>{
    requests.push(options);
    if(requests.length===1)throw new Error('connection lost after commit');
    return {ok:true,json:async()=>({id:JSON.parse(options.body).id})};
  }});
  await assert.rejects(api.mutateMaintenance('item','create',{notes:'test'}));
  await api.mutateMaintenance('item','create',{notes:'test'});
  assert.equal(requests[0].body,requests[1].body);
  assert.equal(requests[0].headers['Idempotency-Key'],requests[1].headers['Idempotency-Key']);
  await api.mutateMaintenance('item','create',{notes:'test'});
  assert.notEqual(requests[1].headers['Idempotency-Key'],requests[2].headers['Idempotency-Key'],'A later successful intentional create is new');
});
