import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import test from 'node:test';import assert from 'node:assert/strict';
function load(options={}){
 let session={accountId:'owner',token:'session-1',generation:1};const calls=[],http=[],cache=new Map();
 const current=captured=>!!session&&!!captured&&session.accountId===captured.accountId&&session.token===captured.token&&session.generation===captured.generation;
 const invoke=async(command,args)=>{calls.push({command,args});if(command==='list_local_resources')return[{id:'r',kind:'file',name:'Fixture',created_at:'',file_type:'text'}];if(command==='local_resource_file_access')return options.access?options.access():{r:{path:'r.capability',pending:false}};if(command==='local_resource_copy_status')return options.copies?options.copies():{r:{state:'ready',verified_bytes:3,size_bytes:3}};throw Error(command);};
 function module(name){if(cache.has(name))return cache.get(name);const exports={};cache.set(name,exports);vm.runInNewContext(ts.transpileModule(readFileSync(new URL(name+'.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Uint8Array,AbortController,URLSearchParams,setTimeout,clearTimeout,require:p=>{
  if(p==='./resource-uploads')return module('resource-uploads');
  if(p==='./auth')return{captureAccountSession:()=>session?{...session}:null,isAccountSessionCurrent:current,getToken:()=>session?.token};
  if(p==='./local-backend')return{localBackend:{invoke}};
  if(p==='@tauri-apps/api/tauri')return{invoke,convertFileSrc:path=>'labos-file://'+path};
  if(p==='../lib/config')return{API_BASE:'http://127.0.0.1:4020/api'};
  if(p==='../lib/runtime')return{isTauriRuntime:()=>true};
  if(p==='./http')return{apiFetch:async()=>{http.push('HTTP');throw Error('HTTP must not run');},apiUrl:path=>path,getApiErrorMessage:async()=>''};
  if(['./resource-tree-moves','./mediaDownloads','./resource-posters','../lib/folderManifest','./resource-metadata-http'].includes(p))return{};
  throw Error(p);
 }});return exports;}
 return{api:module('resources'),calls,http,change:()=>{session={...session,token:'session-2',generation:2};}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('authorized metadata resolves before pending file scans and does not claim readable local bytes',async()=>{
 let access,copies;const c=load({access:()=>new Promise(resolve=>access=resolve),copies:()=>new Promise(resolve=>copies=resolve)});
 let completed=false;const full=c.api.getAllResources().then(rows=>{completed=true;return rows;});await tick();
 assert.equal(c.calls.filter(c=>c.command==='local_resource_file_access').length,1);
 assert.equal(c.calls.filter(c=>c.command==='local_resource_copy_status').length,1,'independent scans start together');
 const metadata=await c.api.getAllResourceMetadata();assert.equal(completed,false);assert.equal(metadata[0].name,'Fixture');assert.equal(metadata[0].local_file_available,undefined);
 access({r:{path:'r.capability',pending:false}});copies({r:{state:'ready',verified_bytes:3,size_bytes:3}});
 assert.equal((await full)[0].local_file_available,true);assert.equal(c.http.length,0);
});
test('many simultaneous filtered resource reads retain metadata and require only one access scan plus one status scan',async()=>{
 let access,copies;const c=load({access:()=>new Promise(resolve=>access=resolve),copies:()=>new Promise(resolve=>copies=resolve)});
 const reads=Array.from({length:20},(_,i)=>c.api.getResources({project_id:'p'+i}));await tick();
 assert.equal(c.calls.filter(c=>c.command==='local_resource_file_access').length,1);
 access({r:{path:'r.capability',pending:false}});await tick();assert.equal(c.calls.filter(c=>c.command==='local_resource_copy_status').length,1);
 copies({r:{state:'ready',verified_bytes:3,size_bytes:3}});const results=await Promise.all(reads);
 assert.ok(results.every(rows=>rows[0].name==='Fixture'&&rows[0].local_file_available&&rows[0].local_copy.state==='ready'));assert.equal(c.http.length,0);
});
test('failed coalesced file proofs do not erase available SQLite metadata or fall back to HTTP',async()=>{
 const c=load({access:()=>{throw Error('no file grant');},copies:()=>{throw Error('no copy status');}});const rows=await c.api.getResources({});assert.equal(rows[0].name,'Fixture');assert.equal(rows[0].local_file_available,false);assert.equal(rows[0].local_copy,undefined);assert.equal(c.http.length,0);
});
test('account-session renewal rejects late metadata/status results without affecting the new session',async()=>{
 let finish;const options={copies:()=>new Promise(resolve=>finish=resolve)},c=load(options);
 const old=c.api.getResources({});const rejected=assert.rejects(old,/Account changed/);await tick();c.change();
 options.copies=()=>({r:{state:'ready',verified_bytes:3,size_bytes:3}});const rows=await c.api.getResources({});assert.equal(rows[0].local_file_available,true);
 finish({r:{state:'ready',verified_bytes:3,size_bytes:3}});await rejected;assert.equal(c.http.length,0);
});
