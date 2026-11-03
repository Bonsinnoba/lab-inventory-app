import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const project=randomUUID(),id=randomUUID(),path=`/projects/${project}/tasks`;
const storage=()=>{const m=new Map();return{getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};
const response=(overrides={})=>({ok:true,status:201,json:async()=>({id,project_id:project}),...overrides});
function load(fetch,{store=storage(),desktop=false,token='online'}={}){
 const exports={},requests=[];let account='a';
 const source=ts.transpileModule(readFileSync(new URL('./project-work-http.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,window:desktop?{__TAURI_IPC__:{}}:{},sessionStorage:store,crypto:{randomUUID},require:name=>{
  if(name==='./auth')return{captureAccountSession:()=>({accountId:account,token}),isAccountSessionCurrent:s=>s.accountId===account};
  if(name==='./http')return{apiFetch:async(...args)=>{requests.push(args);return fetch(...args);},getApiErrorMessage:async()=> 'Denied work change'};
  throw Error(name);
 }});return{write:exports.writeProjectWorkHttp,snapshot:exports.reviewedProjectWork,requests,switchAccount:()=>{account='b';}};
}
test('lost ACK keeps the original body and identity after reload and refreshed base',async()=>{
 const store=storage(),a=load(async()=>{throw Error('lost ACK');},{store});
 await assert.rejects(a.write(path,'POST',{title:'first',expected:{title:'old'}}));
 const b=load(async()=>response(),{store});await b.write(path,'POST',{title:'first',expected:{title:'new'}});
 assert.equal(a.requests[0][1].body,b.requests[0][1].body);
 assert.equal(a.requests[0][1].headers['Idempotency-Key'],b.requests[0][1].headers['Idempotency-Key']);
 await b.write(path,'POST',{title:'first'});assert.notEqual(b.requests[0][1].headers['Idempotency-Key'],b.requests[1][1].headers['Idempotency-Key']);
});
test('account changes reject acknowledgements and never reuse another account intent',async()=>{
 const store=storage();let a;a=load(async()=>{a.switchAccount();return response();},{store});await assert.rejects(a.write(path,'POST',{title:'x'}),/Account changed/);
 const b=load(async()=>response(),{store});b.switchAccount();await b.write(path,'POST',{title:'x'});
 assert.notEqual(a.requests[0][1].headers['Idempotency-Key'],b.requests[0][1].headers['Idempotency-Key']);
});
test('desktop and offline-login tokens never issue HTTP writes',async()=>{
 for(const options of [{desktop:true},{token:'local:a'}]){const c=load(()=>{throw Error('unexpected request');},options);await assert.rejects(c.write(path,'POST',{title:'x'}));assert.equal(c.requests.length,0);}
});
test('definitive conflict clears retry while transient errors preserve it',async()=>{
 for(const status of [409,500,408,429]){
  let fail=true;const c=load(async()=>fail?response({ok:false,status}):response());await assert.rejects(c.write(path,'POST',{title:'x'}));fail=false;await c.write(path,'POST',{title:'x'});
  assert.equal(c.requests[0][1].headers['Idempotency-Key']===c.requests[1][1].headers['Idempotency-Key'],status!==409);
 }
});
test('malformed and wrong-project confirmations retain retry identity',async()=>{
 for(const row of [{},{id,project_id:randomUUID()}]){
  let fail=true;const c=load(async()=>fail?response({json:async()=>row}):response());await assert.rejects(c.write(path,'POST',{title:'x'}),/confirmation/);fail=false;await c.write(path,'POST',{title:'x'});
  assert.equal(c.requests[0][1].headers['Idempotency-Key'],c.requests[1][1].headers['Idempotency-Key']);
 }
});
test('delete requires 204 and reviewed bases contain only editable fields',async()=>{
 const c=load(async()=>response({status:204}));await c.write(`${path}/${id}`,'DELETE',{expected:{title:'x'}});
 const snapshot=c.snapshot('task',{title:'x',description:'',status:'todo',priority:'normal',extra:'secret'});
 assert.equal(snapshot.title,'x');assert.equal(snapshot.assignee_id,null);assert.equal(Object.hasOwn(snapshot,'extra'),false);
 await assert.rejects(load(async()=>response()).write(`${path}/${id}`,'DELETE',{}),/Invalid work confirmation/);
});
test('PATCH and link acknowledgements must match their record and endpoints',async()=>{
 await assert.rejects(load(async()=>response()).write(`${path}/${randomUUID()}`,'PATCH',{title:'x'}),/another record/);
 await assert.rejects(load(async()=>response()).write(`${path}/${id}/experiments`,'POST',{experiment_id:randomUUID(),expected_relationship:null}),/endpoints/);
});
test('unavailable retry storage fails before any request',async()=>{
 const c=load(async()=>response(),{store:{getItem(){throw Error('blocked');}}});await assert.rejects(c.write(path,'POST',{}),/storage/);assert.equal(c.requests.length,0);
});
test('nested measurement confirmations must match their experiment',async()=>{
 const experiment=randomUUID(),p=`/projects/${project}/experiments/${experiment}/measurements`;
 const good=load(async()=>response({json:async()=>({id,project_id:project,experiment_id:experiment})}));
 await good.write(p,'POST',{name:'Voltage',value_numeric:0});
 await assert.rejects(load(async()=>response({json:async()=>({id,project_id:project,experiment_id:randomUUID()})})).write(p,'POST',{name:'Voltage',value_numeric:0}),/another experiment/);
});
test('attachment confirmations bind resource and exactly one reviewed work parent',async()=>{
 const parent=randomUUID(),resource=randomUUID(),p=`/projects/${project}/tasks/${parent}/attachments`;
 const row={id,project_id:project,resource_id:resource,task_id:parent,experiment_id:null};
 await load(async()=>response({json:async()=>row})).write(p,'POST',{resource_id:resource});
 for(const bad of [{...row,resource_id:randomUUID()},{...row,task_id:randomUUID()},{...row,experiment_id:randomUUID()}])await assert.rejects(load(async()=>response({json:async()=>bad})).write(p,'POST',{resource_id:resource}),/different endpoints/);
});
test('uncertain detach retains the originally reviewed resource across reload',async()=>{
 const store=storage(),p=`${path}/${id}/attachments/${randomUUID()}`,original=randomUUID();
 const a=load(async()=>{throw Error('lost ACK');},{store});await assert.rejects(a.write(p,'DELETE',{expected_resource_id:original}));
 const b=load(async()=>response({status:204}),{store});await b.write(p,'DELETE',{expected_resource_id:randomUUID()});
 assert.equal(a.requests[0][1].headers['Idempotency-Key'],b.requests[0][1].headers['Idempotency-Key']);
 assert.equal(JSON.parse(b.requests[0][1].body).expected_resource_id,original);
});
test('item-link confirmations must identify the requested inventory item',async()=>{
 const item=randomUUID(),p=`/projects/${project}/items`,body={item_id:item,allocated_quantity:0,notes:'planning only',expected:null};
 await load(async()=>response({json:async()=>({id:item,item_id:item,project_id:project})})).write(p,'POST',body);
 await assert.rejects(load(async()=>response({json:async()=>({id,item_id:randomUUID(),project_id:project})})).write(p,'POST',body),/different inventory item/);
});
