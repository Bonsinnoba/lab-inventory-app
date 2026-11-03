import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const transpile=file=>ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load({native=true,token='server',http=async()=>({ok:true,status:200,json:async()=>[]}),invoke=async command=>command==='local_current_permissions'?['users.view']:{id:'a',username:'a',role:'admin'}}={}){
 let account='a';const calls=[],ipc=[],cache={};
 const auth={getToken:()=>token,captureAccountSession:()=>({accountId:account}),isAccountSessionCurrent:s=>s.accountId===account,captureServerRequest:async()=>({accountId:account,token}),isServerRequestCurrent:s=>s.accountId===account};
 const require=name=>{
  if(name==='./auth')return auth;
  if(name==='./http')return{apiFetch:async(...args)=>{calls.push(args);return http(...args);},getApiErrorMessage:async()=> 'server rejected'};
  if(name==='@tauri-apps/api/tauri')return{invoke:async(...args)=>{ipc.push(args);return invoke(...args);}};
  if(name==='./administrative-http')return module('./administrative-http.ts');
  throw Error(name);
 };
 function module(file){if(cache[file])return cache[file];const exports={};cache[file]=exports;vm.runInNewContext(transpile(file),{exports,require,window:native?{__TAURI_IPC__:{}}:{}});return exports;}
 return{module,calls,ipc,switchAccount(){account='b';}};
}
test('offline local credentials cannot send administrative writes or passwords',async()=>{
 const c=load({token:'local:lease'}),api=c.module('./users.ts');
 for(const call of [()=>api.getManagedUsers(),()=>api.createManagedUser({username:'x',password:'never-sent',role:'member'}),()=>api.updateManagedUser('x',{role:'admin'}),()=>api.resetManagedUserPassword('x','never-sent')])await assert.rejects(call(),/online/);
 assert.equal(c.calls.length,0);assert.equal(c.ipc.length,0);
});
test('native current permissions use the authorized local snapshot without HTTP',async()=>{
 const c=load();const value=await c.module('./permissions.ts').getCurrentUserPermissions();assert.equal(value.user.id,'a');assert.equal(value.permissions[0].permission,'users.view');assert.equal(c.calls.length,0);
});
test('native permission failures cannot fall through to the server',async()=>{
 const c=load({invoke:async()=>{throw Error('lease expired');}});await assert.rejects(c.module('./permissions.ts').getCurrentUserPermissions(),/lease expired/);assert.equal(c.calls.length,0);
});
test('account switch between local permission and identity reads is rejected',async()=>{
 let c;c=load({invoke:async command=>{if(command==='local_current_permissions'){c.switchAccount();return['users.view'];}return{id:'b'};}});await assert.rejects(c.module('./permissions.ts').getCurrentUserPermissions(),/Session changed/);
});
test('late administrative HTTP and JSON body replies are rejected after account switch',async()=>{
 for(const stage of ['response','body']){
  let c;c=load({native:false,http:async()=>{if(stage==='response')c.switchAccount();return{ok:true,status:200,json:async()=>{if(stage==='body')c.switchAccount();return[];}};}});
  await assert.rejects(c.module('./users.ts').getManagedUsers(),/session changed/);
 }
});
test('administrative failure does not retry or create a local authority mutation',async()=>{
 const c=load({http:async()=>{throw Error('lost connection');}});await assert.rejects(c.module('./users.ts').updateManagedUser('target',{is_active:false}),/lost connection/);assert.equal(c.calls.length,1);assert.equal(c.ipc.length,0);
});
test('targeted administrative replies must identify the requested account',async()=>{
 const c=load({http:async()=>({ok:true,status:200,json:async()=>({user:{id:'other'},permissions:[]})})});
 await assert.rejects(c.module('./users.ts').updateManagedUser('target',{role:'member'}),/not confirmed/);
 await assert.rejects(c.module('./permissions.ts').getUserPermissions('target'),/not confirmed/);
});
