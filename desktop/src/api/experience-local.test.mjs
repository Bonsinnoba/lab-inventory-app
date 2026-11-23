import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function loadDashboard({projects=[{id:'p',name:'Known project',status:'active'}],workspace={tasks:[],experiments:[]},notes=[],resources=[]}={}){
 const cache={};let httpCalls=0,current=true;
 function load(name){
  if(cache[name])return cache[name];const exports={};cache[name]=exports;
  const code=ts.transpileModule(readFileSync(new URL(`./${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,setTimeout,clearTimeout,window:{__TAURI_IPC__:{}},require:path=>{
   if(path==='./read-availability')return load('read-availability');
   if(path==='./auth')return{captureAccountSession:()=>({accountId:'a'}),isAccountSessionCurrent:()=>current};
   if(path==='./projects')return{getProjects:async()=>projects,getProjectWorkspace:async()=>typeof workspace==='function'?workspace():workspace};
   if(path==='./items')return{getItems:async()=>[]};
   if(path==='./notes')return{getNotes:async()=>notes};
   if(path==='./resources')return{getAllResourceMetadata:async()=>resources};
   if(path==='./notifications')return{};
   if(path==='./http')return{apiFetch:()=>{httpCalls++;throw Error('No HTTP allowed in native projection')}};
   throw Error(path);
  }});return exports;
 }
 return{get:load('experience').getExperienceDashboard,httpCalls:()=>httpCalls,switchAccount:()=>{current=false}};
}

test('missing experiments keep recent activity partial while preserving known tasks',async()=>{
 const c=loadDashboard({workspace:{tasks:[{id:'t',title:'Known task',created_at:'2026-11-18T10:00:00Z'}]}});
 const r=await c.get();
 assert.equal(r.availability.sections.tasks,'available');
 assert.equal(r.availability.sections.experiments,'partial');
 assert.equal(r.availability.sections.recent,'partial');
 assert.equal(r.recent[0].title,'Known task');assert.equal(r.projects[0].health,'unknown');assert.equal(c.httpCalls(),0);
});

test('complete empty workspaces are available, including the zero-project case',async()=>{
 for(const projects of [[],[{id:'p',name:'Project',status:'active'}]]){
  const c=loadDashboard({projects});const r=await c.get();
  assert.equal(r.availability.sections.experiments,'available');assert.equal(r.availability.sections.recent,'available');
  assert.equal(r.metrics.overdue_tasks,0);assert.equal(c.httpCalls(),0);
 }
});

test('unavailable projects leave tasks unknown but retain independent notes and resources',async()=>{
 const c=loadDashboard({projects:null,notes:[{id:'n',title:'Saved note',created_at:'2026-11-18T10:00:00Z'}],resources:[{id:'r',name:'Saved file',created_at:'2026-11-18T09:00:00Z'}]});
 const r=await c.get();assert.equal(r.metrics.active_projects,null);assert.equal(r.metrics.overdue_tasks,null);
 assert.equal(r.availability.sections.experiments,'unavailable');assert.equal(r.availability.sections.recent,'partial');
 assert.deepEqual(Array.from(r.recent,x=>x.title),['Saved note','Saved file']);assert.equal(c.httpCalls(),0);
});

test('account change during workspace reads discards all projected content',async()=>{
 let c;c=loadDashboard({workspace:()=>{c.switchAccount();return{tasks:[],experiments:[]}}});
 await assert.rejects(c.get(),/Account changed/);assert.equal(c.httpCalls(),0);
});
