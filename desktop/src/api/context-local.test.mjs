import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function load(options={}){
 let current=true;const session={accountId:'a',generation:1},http=[];
 const auth={captureAccountSession:()=>session,isAccountSessionCurrent:s=>s===session&&current};
 function module(file,require){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,setTimeout,clearTimeout});return exports;}
 const availability=module('./read-availability.ts',()=>auth);
 const workspace={tasks:[{id:'t',title:'Unsynced task',status:'todo'}],experiments:[],items:[{item_id:'i'}],permissions:{access:'edit'}};
 const api=module('./context.ts',path=>{
  if(path==='./auth')return auth;
  if(path==='../lib/runtime')return {isTauriRuntime:()=>!options.browser};
  if(path==='./read-availability')return availability;
  if(path==='./http')return {apiFetch:async path=>{http.push(path);return{ok:true,json:async()=>({source:'server'})}}};
  if(path==='./projects')return {
   getProject:async()=>{if(options.rootError)throw Error('Denied');if(options.switchRoot)current=false;return{id:'p',name:'Project',status:'planning'};},
   getProjectWorkspace:async()=>options.workspace??workspace,
   getProjectReservations:async()=>{if(options.switchSection)current=false;return[];},
  };
  if(path==='./items')return {getItems:async()=>options.items??[{id:'i',name:'Sensor',current_quantity:4,unit:'pcs'}]};
  if(path==='./notes')return {getNotes:async filters=>{assert.equal(filters.project_id,'p');if(options.notesError)throw Error('Restricted');return[{id:'n',title:'Local note'}];}};
  if(path==='./resources')return {getResources:async filters=>{assert.equal(filters.project_id,'p');return[{id:'r',name:'Local resource'}];}};
  throw Error('Unexpected import '+path);
 });
 return {api,http};
}
test('desktop context composes local reads with no HTTP and honest provenance',async()=>{
 const c=load(),r=await c.api.getProjectContext('p');
 assert.equal(c.http.length,0);assert.equal(r.sections.tasks[0].title,'Unsynced task');
 assert.equal(r.sections.inventory[0].current_quantity,4);assert.equal(r.sections.notes[0].id,'n');
 assert.equal(r.availability.sections.resources,'available');assert.equal(r.provenance.source,'local_repositories');
 assert.equal(r.freshness,'local_read_not_server_confirmation');assert.equal(r.generated_at,r.availability.readAt);
});
test('failed and malformed sections are unknown while independent sections survive',async()=>{
 const c=load({notesError:true,workspace:{tasks:null,experiments:[],items:[]}}),r=await c.api.getProjectContext('p');
 assert.equal(r.availability.sections.notes,'unavailable');assert.equal(r.availability.sections.tasks,'unavailable');
 assert.equal(r.availability.sections.experiments,'available');assert.equal(r.sections.resources.length,1);assert.equal(c.http.length,0);
});
test('missing authorized inventory rows are partial, not fabricated quantities',async()=>{
 const c=load({items:[]}),r=await c.api.getProjectContext('p');
 assert.equal(r.availability.sections.inventory,'partial');assert.equal(r.sections.inventory.length,0);
});
test('root access failure does not fall back to server',async()=>{
 const c=load({rootError:true});await assert.rejects(c.api.getProjectContext('p'),/Denied/);assert.equal(c.http.length,0);
});
test('account changes discard root and composite results',async()=>{
 for(const option of ['switchRoot','switchSection']){const c=load({[option]:true});await assert.rejects(c.api.getProjectContext('p'),/Account changed/);assert.equal(c.http.length,0);}
});
test('browser retains its central context endpoint',async()=>{
 const c=load({browser:true});assert.equal((await c.api.getProjectContext('p')).source,'server');assert.deepEqual(c.http,['/context/projects/p']);
});
test('context panel hides previous data on root authorization/read failure',()=>{
 const source=readFileSync(new URL('../components/ProjectContextPanel.tsx',import.meta.url),'utf8');
 assert.match(source,/const c=context\.isError\?undefined:context\.data/);
});
