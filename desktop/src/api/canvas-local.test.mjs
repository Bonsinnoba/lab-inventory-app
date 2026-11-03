import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const project=randomUUID(),id=randomUUID(),block={id,project_id:project,block_type:'text',text_content:'Reviewed',title:null,x:0,y:0,width:320,height:200};
function load({desktop=true,signedIn=true,invoke=async()=>({blocks:[],connectors:[]}),http=async()=>({ok:true,status:200,json:async()=>({blocks:[],connectors:[]})})}={}){
 let account='a';const exports={},requests=[],ipc=[],store=new Map();
 const transpile=file=>ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context={exports,window:desktop?{__TAURI_IPC__:{}}:{},crypto:{randomUUID},sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)},require:name=>{
  if(name==='@tauri-apps/api/tauri')return{invoke:async(...args)=>{ipc.push(args);return invoke(...args);}};
  if(name==='./auth')return{captureAccountSession:()=>signedIn?{accountId:account,token:'server'}:null,isAccountSessionCurrent:s=>s?.accountId===account&&signedIn};
  if(name==='./http')return{apiFetch:async(...args)=>{requests.push(args);return http(...args);},getApiErrorMessage:async()=> 'Canvas write failed'};
  if(name==='./project-work-http'){const work={};vm.runInNewContext(transpile('./project-work-http.ts'),{...context,exports:work});return work;}
  throw Error(name);
 }};
 vm.runInNewContext(transpile('./canvas.ts'),context);return{api:exports,requests,ipc,switchAccount:()=>{account='b';}};
}
test('native canvas requires a session and never falls back after IPC failures',async()=>{
 const absent=load({signedIn:false});await assert.rejects(absent.api.getCanvas(project),/Sign in/);assert.equal(absent.ipc.length,0);
 const failed=load({invoke:async()=>{throw Error('SQLite failed');}});
 for(const action of [()=>failed.api.getCanvas(project),()=>failed.api.createBlock(project,block),()=>failed.api.updateBlock(id,{project_id:project,title:'New'},block),()=>failed.api.deleteBlock(id,project,block),()=>failed.api.createConnector(project,{source_block_id:id,target_block_id:randomUUID()}),()=>failed.api.deleteConnector(id,project,{id})])await assert.rejects(action(),/SQLite failed/);
 assert.equal(failed.requests.length,0);
});
test('native account switches suppress late canvas reads and writes',async()=>{
 let c;c=load({invoke:async()=>{c.switchAccount();return block;}});await assert.rejects(c.api.updateBlock(id,{project_id:project,title:'New'},block),/Account changed/);assert.equal(c.requests.length,0);
 let read;read=load({invoke:async()=>{read.switchAccount();return{blocks:[block],connectors:[]};}});await assert.rejects(read.api.getCanvas(project),/Account changed/);
});
test('missing snapshots fail closed while native void deletes remain local',async()=>{
 const missing=load({invoke:async()=>null});await assert.rejects(missing.api.getCanvas(project),/unavailable/);await assert.rejects(missing.api.createBlock(project,block),/unavailable/);assert.equal(missing.requests.length,0);
 const malformed=load({invoke:async()=>({})});await assert.rejects(malformed.api.getCanvas(project),/incomplete/);
 const deleted=load({invoke:async()=>undefined});await deleted.api.deleteBlock(id,project,block);assert.equal(deleted.requests.length,0);assert.equal(deleted.ipc[0][1].expected,block);
});
test('browser flat updates retain project and reviewed values and stable uncertain retry identity',async()=>{
 let fail=true;const c=load({desktop:false,http:async()=>{if(fail)throw Error('lost ACK');return{ok:true,status:200,json:async()=>({...block,title:'New'})};}});
 await assert.rejects(c.api.updateBlock(id,{project_id:project,title:'New'},block));fail=false;
 await c.api.updateBlock(id,{project_id:project,title:'New'},{...block,text_content:'Refreshed'});
 assert.equal(c.requests[0][0],`/blocks/${id}`);assert.equal(c.requests[0][1].headers['Idempotency-Key'],c.requests[1][1].headers['Idempotency-Key']);
 const body=JSON.parse(c.requests[1][1].body);assert.equal(body.project_id,project);assert.equal(body.expected.text_content,'Reviewed');
});
test('browser reads suppress old-account results and malformed snapshots',async()=>{
 let c;c=load({desktop:false,http:async()=>{c.switchAccount();return{ok:true,json:async()=>({blocks:[block],connectors:[]})};}});await assert.rejects(c.api.getCanvas(project),/Account changed/);
 await assert.rejects(load({desktop:false,http:async()=>({ok:true,json:async()=>({})})}).api.getCanvas(project),/incomplete/);
});
