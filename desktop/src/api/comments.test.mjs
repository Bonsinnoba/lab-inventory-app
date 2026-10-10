import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load(desktop,invoke,fetch){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./comments.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto:{randomUUID},require:p=>{
  if(p==='./local-backend')return{localBackend:{isAvailable:()=>desktop,invoke}};
  if(p==='./auth')return{captureAccountSession:()=>({accountId:'a'}),isAccountSessionCurrent:()=>true};
  if(p==='./http')return{apiFetch:fetch,getApiErrorMessage:async()=> 'rejected'};throw Error(p);
}});return exports;}
for(const failure of ['null','reject'])test(`comments ${failure} IPC never falls back to HTTP`,async()=>{
  let writes=0;const api=load(true,async()=>{if(failure==='reject')throw Error('disk');return null},async()=>{writes++;});
  await assert.rejects(api.listComments('project'));await assert.rejects(api.mutateComment('project','create','text'));await assert.rejects(api.mutateComment('project','delete',undefined,'id'));assert.equal(writes,0);
});
test('comments browser lost ACK retains both identity and key',async()=>{
  const calls=[];const api=load(false,null,async(path,options)=>{calls.push(options);if(calls.length===1)throw Error('lost ACK');return{ok:true,json:async()=>JSON.parse(options.body)}});
  await assert.rejects(api.mutateComment('project','create','text'));await api.mutateComment('project','create','text');
  assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
});
