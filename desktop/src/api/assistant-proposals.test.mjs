import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const graph=JSON.parse(readFileSync(new URL('../../../contracts/assistant-proposal-cases.json',import.meta.url),'utf8'))[0].normalized;
function load({native=false,token='server',invoke=async()=>{throw Error('SQLite unavailable');},http=async()=>{throw Error('Network unavailable');}}={}){
 let account='a';const calls=[],storage=new Map(),exports={},contract={};
 const compile=file=>ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compile('./assistant-proposal-contract.ts'),{exports:contract,TextEncoder,crypto:webcrypto});
 vm.runInNewContext(compile('./assistant-proposals.ts'),{exports,crypto:webcrypto,sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},require:name=>{
  if(name==='./assistant-proposal-contract')return contract;
  if(name==='./local-backend')return{localBackend:{isAvailable:()=>native,invoke}};
  if(name==='./auth')return{captureAccountSession:()=>({accountId:account}),isAccountSessionCurrent:s=>s.accountId===account,getToken:()=>token};
  if(name==='./http')return{apiFetch:async(...args)=>{calls.push(args);return http(...args);},getApiErrorMessage:async()=> 'Request unavailable'};
  throw Error(name);
 }});
 return{api:exports,calls,storage,switchAccount(){account='b';}};
}
const draft=()=>({id:webcrypto.randomUUID(),title:'Reviewed',graph,generation_id:null,revision:1,state:'draft',author_id:'a'});
const reply=result=>({ok:true,json:async()=>result});
test('native proposal SQLite failure never falls back to a server write',async()=>{
 const c=load({native:true}),row=draft();await assert.rejects(c.api.saveAssistantProposal({...row,expected_revision:1}),/SQLite unavailable/);await assert.rejects(c.api.acceptAssistantProposal(row,true),/SQLite unavailable/);assert.equal(c.calls.length,0);
});
test('lost browser receipt retries the exact original intention after editor is gone',async()=>{
 let first=true;const c=load({http:async(path,init)=>{if(first){first=false;throw Error('lost receipt');}const event=JSON.parse(init.body).changes[0];return reply({results:[{change_id:event.change_id,status:'synced',result:{id:event.entity_id,revision:2,state:'draft',graph_digest:await c.api.proposalDigest(graph)}}]});}}),row=draft();
 await assert.rejects(c.api.saveAssistantProposal({...row,expected_revision:1}),/lost receipt/);
 await assert.rejects(c.api.saveAssistantProposal({...row,title:'different',expected_revision:1}),/uncertain outcome/);assert.equal(c.calls.length,1);
 await c.api.retryPendingAssistantProposal();assert.equal(c.calls[0][1].body,c.calls[1][1].body);assert.equal(c.storage.size,0);
});
test('browser approval cannot clear its retry intent on an incomplete graph receipt',async()=>{
 const c=load({http:async(path,init)=>{const event=JSON.parse(init.body).changes[0];return reply({results:[{change_id:event.change_id,status:'synced',result:{id:event.entity_id,revision:2,state:'accepted',graph_digest:event.payload.graph_digest,project_id:graph.target.project_id,applied:{projects:1,tasks:0,experiments:1,links:1}}}]});}});
 await assert.rejects(c.api.acceptAssistantProposal(draft(),true),/Complete accepted/);assert.equal(c.storage.size,1);
});
test('account change during response cannot acknowledge a saved browser proposal',async()=>{
 let c;c=load({http:async()=>{c.switchAccount();return reply({});}});await assert.rejects(c.api.saveAssistantProposal({...draft(),expected_revision:1}),/session changed/);assert.equal(c.storage.size,1);
});
test('browser local lease cannot write or generate; approval needs explicit confirmation',async()=>{
 const c=load({token:'local:lease'});await assert.rejects(c.api.saveAssistantProposal({...draft(),expected_revision:1}),/online/);await assert.rejects(c.api.generateAssistantProposal('Plan',null),/online/);await assert.rejects(c.api.acceptAssistantProposal(draft(),false),/confirmation/);assert.equal(c.calls.length,0);
});
test('generation retry retains identity until explicit regeneration',async()=>{
 const c=load({http:async(path,init)=>reply({id:init.headers['Idempotency-Key'],state:'pending'})});const a=await c.api.generateAssistantProposal('Plan',null),b=await c.api.generateAssistantProposal('Plan',null);assert.equal(a.id,b.id);
 await assert.rejects(c.api.generateAssistantProposal('Changed',null),/previous generation/);const fresh=await c.api.generateAssistantProposal('Changed',null,true);assert.notEqual(fresh.id,a.id);
});
