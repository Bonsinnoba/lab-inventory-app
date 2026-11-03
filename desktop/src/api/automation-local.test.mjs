import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load({desktop=true,invoke=async()=>null,http=async()=>{throw Error('network');},items=[],projects=[],workspace=async()=>({tasks:[]})}={}){
 let account='a';const exports={},calls=[],store=new Map(),session=()=>({accountId:account});
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./automation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto:{randomUUID},sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},require:name=>{
  if(name==='./local-backend')return{localBackend:{isAvailable:()=>desktop,invoke}};
  if(name==='./http')return{apiFetch:async(...args)=>{calls.push(args);return http(...args);},getApiErrorMessage:async()=> 'failed'};
  if(name==='./auth')return{captureAccountSession:session,isAccountSessionCurrent:s=>s.accountId===account,getToken:()=> 'server'};
  if(name==='./items')return{getItems:async()=>items};
  if(name==='./projects')return{getProjects:async()=>projects,getProjectWorkspace:workspace};
  if(name==='./read-availability')return{assertReadAccount:s=>{if(s.accountId!==account)throw Error('Account changed');},readWithDeadline:read=>read(),readLocalSections:async loaders=>{const values={},sections={};for(const [key,read] of Object.entries(loaders)){try{values[key]=await read();sections[key]='available';}catch{values[key]=null;sections[key]='unavailable';}}return{values,availability:{source:'local',sections}};}};
  throw Error(name);
 }});return{api:exports,calls,switchAccount(){account='b';}};
}
test('desktop automation queues locally without an HTTP fallback',async()=>{
 const run=randomUUID(),c=load({invoke:async command=>{assert.equal(command,'queue_local_automation_run');return{run_id:run,queued:true,executed:false};}});assert.equal((await c.api.runAutomation()).executed,false);assert.equal(c.calls.length,0);
 const failed=load({invoke:async()=>{throw Error('SQLite unavailable');}});await assert.rejects(failed.api.runAutomation(),/SQLite/);assert.equal(failed.calls.length,0);
 await assert.rejects(load().api.runAutomation(),/not confirmed/);
});
test('offline automation projects cached due work and excludes done or undated tasks',async()=>{
 const c=load({items:[{id:'due',next_maintenance_date:'2000-01-01'},{id:'no-date',next_maintenance_date:''}],projects:[{id:'p',name:'Project'}],workspace:async()=>({tasks:[{id:'task',due_date:'2000-01-01',status:'todo'},{id:'done',due_date:'2000-01-01',status:'done'},{id:'undated',due_date:''}]})});const due=await c.api.getAutomationDue();assert.equal(due.maintenance.length,1);assert.equal(due.tasks.length,1);assert.equal(due.tasks[0].project_name,'Project');assert.equal(due.availability.sections.tasks,'available');assert.equal(c.calls.length,0);
});
test('unavailable local work is explicit partial data and never invokes server',async()=>{
 const c=load({projects:[{id:'p'}],workspace:async()=>{throw Error('unavailable');}});const due=await c.api.getAutomationDue();assert.equal(due.availability.sections.tasks,'partial');assert.equal(c.calls.length,0);
});
test('late automation intent confirmation cannot cross accounts',async()=>{
 let c;c=load({invoke:async()=>{c.switchAccount();return{run_id:randomUUID(),queued:true,executed:false};}});await assert.rejects(c.api.runAutomation(),/Account changed/);
});
test('uncertain browser run retries the original persisted run UUID',async()=>{
 let calls=0;const c=load({desktop:false,http:async(_path,init)=>{if(++calls===1)throw Error('lost response');return{ok:true,json:async()=>({run_id:init.headers['Idempotency-Key'],created:0,executed:true})};}});await assert.rejects(c.api.runAutomation(),/lost response/);assert.equal((await c.api.runAutomation()).executed,true);assert.equal(c.calls[0][1].headers['Idempotency-Key'],c.calls[1][1].headers['Idempotency-Key']);
});
