import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load({desktop=true,protocol=2,fail=false,switchAt=null}={}){
 const calls=[],exports={};let current=true;
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./resource-tree-moves.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{
  if(name==='./auth')return{captureAccountSession:()=>({accountId:'account'}),isAccountSessionCurrent:()=>current,getToken:()=> 'local:offline'};
  if(name==='../lib/runtime')return{isTauriRuntime:()=>desktop};
  if(name==='@tauri-apps/api/tauri')return{invoke:async(command,args)=>{calls.push({command,args});if(command===switchAt)current=false;if(command==='local_database_status')return{resource_tree_move_protocol:protocol};if(command==='local_authorization_guard')return 'native-session';if(command==='prepare_local_resource_tree_move'){if(fail)throw Error('Review unavailable');return{review_id:'opaque-native-ticket',resource_id:'folder',member_count:3};}if(command==='move_local_resource_tree')return{id:'folder',kind:'folder'};throw Error(command);}};
  throw Error(name);
 }});return{api:exports,calls};
}
test('tree authoring passes only opaque native review identity, never a renderer manifest',async()=>{
 const c=load();assert.equal((await c.api.moveResourceTree('folder',{parent_resource_id:'target'})).id,'folder');
 const call=c.calls.at(-1);assert.equal(call.command,'move_local_resource_tree');assert.deepEqual(JSON.parse(JSON.stringify(call.args)),{expectedAccountId:'account',expectedSessionToken:'native-session',reviewId:'opaque-native-ticket'});
 assert.equal(c.calls[2].args.serverToken,'local:offline','native may reuse a lease-bound review without network credentials');
});
test('review preparation cannot publish an outbox intention',async()=>{
 const c=load();assert.equal(await c.api.prepareResourceTreeMove('folder',{}),3);assert.equal(c.calls.some(c=>c.command==='move_local_resource_tree'),false);
});
test('browser, old binary and native failure never use a server-write fallback',async()=>{
 for(const options of [{desktop:false},{protocol:0},{fail:true}]){const c=load(options);await assert.rejects(c.api.moveResourceTree('folder',{}));assert.equal(c.calls.some(c=>c.command==='move_local_resource_tree'),false);}
});
test('account switches at every asynchronous preflight boundary stop publication',async()=>{
 for(const command of ['local_database_status','local_authorization_guard','prepare_local_resource_tree_move']){const c=load({switchAt:command});await assert.rejects(c.api.moveResourceTree('folder',{}),/Account changed/);assert.equal(c.calls.some(c=>c.command==='move_local_resource_tree'),false);}
});
