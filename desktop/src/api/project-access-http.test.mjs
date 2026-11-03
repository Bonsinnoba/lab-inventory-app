import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

const target='20000000-0000-4000-8000-000000000001',path='/projects/p/members';
const body={user_id:target,member_role:'member',expected_value:null};
const success=()=>({ok:true,status:201,json:async()=>({user_id:target,member_role:'member'})});
const storage=()=>{const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};};
function load(fetch,{store=storage(),desktop=false,refresh=async()=>{},token='server-token'}={}){
 const exports={},requests=[];let account='a';
 const js=ts.transpileModule(readFileSync(new URL('./project-access-http.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{exports,sessionStorage:store,crypto:{randomUUID},require:name=>{
  if(name==='./auth')return{captureAccountSession:()=>({accountId:account,token}),isAccountSessionCurrent:s=>s.accountId===account};
  if(name==='./http')return{apiFetch:async(...args)=>{requests.push(args);return fetch(...args);},getApiErrorMessage:async()=> 'Denied access change'};
  if(name==='./local-backend')return{isLocalBackendAvailable:()=>desktop};
  if(name==='./sync')return{refreshConfirmedProjectAccess:refresh};throw Error(name);
 }});
 return{write:exports.writeProjectAccessHttp,read:exports.readProjectAccessHttp,requests,switchAccount:()=>{account='b';}};
}
test('administrative read responses are scoped to the current account and reject malformed lists',async()=>{
 let c;c=load(async()=>{c.switchAccount();return{ok:true,json:async()=>[{user_id:target}]};});
 await assert.rejects(c.read('/projects/p/access-grants'),/Account changed/);
 assert.equal(c.requests[0][1].cache,'no-store');
 const malformed=load(async()=>({ok:true,json:async()=>({members:[]})}));await assert.rejects(malformed.read('/projects/p/member-candidates'),/Invalid project access/);
});
test('uncertain access requests preserve key and original expected value across reload',async()=>{
 const store=storage(),a=load(async()=>{throw Error('lost ACK')},{store});await assert.rejects(a.write(path,'POST',body));
 const b=load(async()=>success(),{store});await b.write(path,'POST',{...body,expected_value:'member'});
 assert.equal(a.requests[0][1].body,b.requests[0][1].body);assert.equal(a.requests[0][1].headers['Idempotency-Key'],b.requests[0][1].headers['Idempotency-Key']);
 await b.write(path,'POST',body);assert.notEqual(b.requests[0][1].headers['Idempotency-Key'],b.requests[1][1].headers['Idempotency-Key']);
});
test('server-confirmed desktop writes reconcile cache before forgetting retry identity',async()=>{
 const store=storage(),events=[];let fail=true;
 const c=load(async()=>{events.push('server');return success();},{store,desktop:true,refresh:async()=>{events.push('refresh');if(fail)throw Error('disk error');}});
 await assert.rejects(c.write(path,'POST',body),/Server confirmed.*local project refresh is pending/);fail=false;
 await c.write(path,'POST',{...body,expected_value:'member'});
 assert.deepEqual(events,['server','refresh','server','refresh']);assert.equal(c.requests[0][1].body,c.requests[1][1].body);
 assert.equal(c.requests[0][1].headers['Idempotency-Key'],c.requests[1][1].headers['Idempotency-Key']);
});
test('failed, malformed and account-switched responses never refresh native authority',async()=>{
 let refreshes=0,fail=true;
 const malformed=load(async()=>fail?{ok:true,status:201,json:async()=>null}:success(),{desktop:true,refresh:async()=>{refreshes++;}});
 await assert.rejects(malformed.write(path,'POST',body),/Invalid membership/);assert.equal(refreshes,0);fail=false;
 await malformed.write(path,'POST',body);assert.equal(malformed.requests[0][1].headers['Idempotency-Key'],malformed.requests[1][1].headers['Idempotency-Key']);
 let switched;switched=load(async()=>{switched.switchAccount();return success();},{desktop:true,refresh:async()=>{refreshes++;}});
 await assert.rejects(switched.write(path,'POST',body),/Account changed/);assert.equal(refreshes,1);
 const offline=load(async()=>{throw Error('offline');},{desktop:true,refresh:async()=>{refreshes++;}});
 await assert.rejects(offline.write(path,'POST',body),/offline/);assert.equal(refreshes,1);
});
test('missing bases, local-only sessions and unavailable persistence cannot send access writes',async()=>{
 for(const options of [{token:'local:cached'},{store:{getItem:()=>null,setItem:()=>{throw Error('quota');}}}]){
  const c=load(async()=>success(),options);await assert.rejects(c.write(path,'POST',body));assert.equal(c.requests.length,0);
 }
 const c=load(async()=>success());await assert.rejects(c.write(path,'POST',{user_id:target,member_role:'member'}),/value you reviewed/);assert.equal(c.requests.length,0);
});
test('definitive denial releases retry identity while a delete lost ACK retains it',async()=>{
 let fail=true;const c=load(async()=>fail?{ok:false,status:403}:success());await assert.rejects(c.write(path,'POST',body));fail=false;await c.write(path,'POST',body);
 assert.notEqual(c.requests[0][1].headers['Idempotency-Key'],c.requests[1][1].headers['Idempotency-Key']);
 const store=storage(),remove=`/projects/p/members/${target}`,a=load(async()=>{throw Error('lost ACK');},{store});
 await assert.rejects(a.write(remove,'DELETE',{expected_value:'member'}));
 const b=load(async()=>({ok:true,status:204}),{store});await b.write(remove,'DELETE',{expected_value:'observer'});
 assert.equal(a.requests[0][1].body,b.requests[0][1].body);assert.equal(a.requests[0][1].headers['Idempotency-Key'],b.requests[0][1].headers['Idempotency-Key']);
});

const syncSource=readFileSync(new URL('./sync.ts',import.meta.url),'utf8');
function coordinator(seed,pull,current=()=>true){
 const block=syncSource.slice(syncSource.indexOf('export async function refreshConfirmedProjectAccess'),syncSource.indexOf('let currentSyncSession:'));
 const source='let currentSyncSession=null;let activeSync=seed?seed.finally(()=>{activeSync=null;}):null;'+block+';exports.refresh=refreshConfirmedProjectAccess;';
 const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,seed,pullServerProjects:pull,assertSyncSession:()=>{if(!current())throw Error('Account changed');}});return exports.refresh;
}
test('confirmed-access refreshes serialize behind background sync and each other',async()=>{
 let releaseSeed,releasePull,calls=0,concurrent=0,max=0;
 const seed=new Promise(resolve=>{releaseSeed=resolve;});
 const refresh=coordinator(seed,async()=>{calls++;concurrent++;max=Math.max(max,concurrent);if(calls===1)await new Promise(resolve=>{releasePull=resolve;});concurrent--;return true;});
 const a=refresh({accountId:'a'}),b=refresh({accountId:'a'});assert.equal(calls,0);releaseSeed();
 while(!releasePull)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);releasePull();await Promise.all([a,b]);assert.equal(calls,2);assert.equal(max,1);
});
test('a switched session cannot start its delayed authority refresh',async()=>{
 let release,calls=0,current=true;const seed=new Promise(resolve=>{release=resolve;});
 const refresh=coordinator(seed,async()=>{calls++;return true;},()=>current);
 const pending=refresh({accountId:'a'});current=false;release();await assert.rejects(pending,/Account changed/);assert.equal(calls,0);
});
test('incomplete project pulls cannot become empty authoritative cache snapshots',async()=>{
 const block=syncSource.slice(syncSource.indexOf('async function pullServerProjects()'),syncSource.indexOf('async function pullServerResources()'));
 const exports={};let writes=0;
 const js=ts.transpileModule(block+';exports.pull=pullServerProjects;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{exports,apiFetch:async()=>({ok:true,json:async()=>({projects:[]})}),publish:()=>{},assertSyncSession:()=>{},syncAccountId:()=> 'a',invoke:async()=>{writes++;}});
 assert.equal(await exports.pull(),false);assert.equal(writes,0);
});
