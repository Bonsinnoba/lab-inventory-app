import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const transpile=file=>ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load({native=true,token='server',http=async()=>({ok:true,status:200,json:async()=>[]}),invoke=async command=>command==='local_current_permissions'?['users.view']:{id:'a',username:'a',role:'admin'}}={}){
 let account='a';const calls=[],ipc=[],cache={};
 const auth={getToken:()=>token,captureAccountSession:()=>({accountId:account}),isAccountSessionCurrent:s=>s.accountId===account,captureServerRequest:async()=>({accountId:account,token,nativeSessionToken:'native-session'}),isServerRequestCurrent:s=>s.accountId===account,observeNativeAuthFailure:async()=>{}};
 const require=name=>{
  if(name==='./auth')return auth;
  if(name==='./http')return{apiFetch:async(...args)=>{calls.push(args);return http(...args);},getApiErrorMessage:async()=> 'server rejected'};
  if(name==='@tauri-apps/api/tauri')return{invoke:async(...args)=>{ipc.push(args);return invoke(...args);}};
  if(name==='./administrative-http')return module('./administrative-http.ts');
  throw Error(name);
 };
 function module(file){if(cache[file])return cache[file];const exports={};cache[file]=exports;vm.runInNewContext(transpile(file),{exports,require,crypto:webcrypto,TextEncoder,Headers,window:native?{__TAURI_IPC__:{}}:{}});return exports;}
 return{module,calls,ipc,switchAccount(){account='b';}};
}
test('offline local credentials cannot send administrative writes or passwords',async()=>{
 const c=load({token:'local:lease'}),api=c.module('./users.ts');
 for(const call of [()=>api.createManagedUser({username:'x',password:'never-sent',role:'member'}),()=>api.updateManagedUser('x',{role:'admin'}),()=>api.resetManagedUserPassword('x','never-sent')])await assert.rejects(call(),/online/);
 assert.equal(c.calls.length,0);assert.equal(c.ipc.length,0);
});
test('native current permissions use the authorized local snapshot without HTTP',async()=>{
 const c=load();const value=await c.module('./permissions.ts').getCurrentUserPermissions();assert.equal(value.user.id,'a');assert.equal(value.permissions[0].permission,'users.view');assert.equal(c.calls.length,0);
});
test('native managed directory is local-first even with offline credentials; failures never become HTTP reads',async()=>{
 const cached=load({token:'local:lease',invoke:async command=>{assert.equal(command,'get_local_managed_users');return[];}});
 assert.equal((await cached.module('./users.ts').getManagedUsers()).length,0);assert.equal(cached.calls.length,0);
 const broken=load({invoke:async()=>{throw Error('cache unavailable');}});await assert.rejects(broken.module('./users.ts').getManagedUsers(),/cache unavailable/);assert.equal(broken.calls.length,0);
 let changed;changed=load({invoke:async()=>{changed.switchAccount();return[];}});await assert.rejects(changed.module('./users.ts').getManagedUsers(),/session changed/);
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
 const c=load({http:async()=>{throw Error('lost connection');}});await assert.rejects(c.module('./users.ts').updateManagedUser('target',{is_active:false},'a'.repeat(64)),/lost connection/);assert.equal(c.calls.length,1);assert.equal(c.ipc.length,0);
});
test('targeted administrative replies must identify the requested account',async()=>{
 const c=load({native:false,http:async()=>({ok:true,status:200,json:async()=>({user:{id:'other'},permissions:[]})})});
 await assert.rejects(c.module('./users.ts').updateManagedUser('target',{role:'member'},'a'.repeat(64)),/not confirmed/);
 await assert.rejects(c.module('./permissions.ts').getUserPermissions('target'),/not confirmed/);
});
test('native target permission profiles are cached reads and reject missing or foreign replies without HTTP',async()=>{
 const cached=load({token:'local:lease',invoke:async command=>{assert.equal(command,'get_local_user_permission_profile');return{user:{id:'target',username:'Target',role:'member'},permissions:[]};}});
 assert.equal((await cached.module('./permissions.ts').getUserPermissions('target')).user.id,'target');assert.equal(cached.calls.length,0);
 const missing=load({invoke:async()=>{throw Error('profile not synchronized');}});await assert.rejects(missing.module('./permissions.ts').getUserPermissions('target'),/not synchronized/);assert.equal(missing.calls.length,0);
 const foreign=load({invoke:async()=>({user:{id:'other'},permissions:[]})});await assert.rejects(foreign.module('./permissions.ts').getUserPermissions('target'),/not confirmed/);assert.equal(foreign.calls.length,0);
});
test('native refresh keeps the server JWT separate from the native session fence',async()=>{
 const c=load({token:'server-jwt',invoke:async()=>undefined});await c.module('./users.ts').refreshManagedUsers();await c.module('./permissions.ts').refreshUserPermissions('target');
 assert.equal(c.calls.length,0);assert.equal(c.ipc.length,2);for(const [,args] of c.ipc){assert.equal(args.serverToken,'server-jwt');assert.equal(args.expectedSessionToken,'native-session');assert.equal(args.expectedAccountId,'a');}
 const offline=load({token:'local:offline'});await assert.rejects(offline.module('./users.ts').refreshManagedUsers(),/online/);assert.equal(offline.ipc.length,0);
});
test('administrative uncertain retry preserves its key and only hashes requests in memory',async()=>{
 let attempts=0;const c=load({http:async()=>{if(!attempts++)throw Error('lost response');return{ok:true,status:200,json:async()=>({user:{id:'target'}})};}}),api=c.module('./users.ts');
 await assert.rejects(api.updateManagedUser('target',{is_active:false},'a'.repeat(64)),/lost response/);await api.updateManagedUser('target',{is_active:false},'a'.repeat(64));
 assert.equal(c.calls[0][1].headers.get('Idempotency-Key'),c.calls[1][1].headers.get('Idempotency-Key'));assert.equal(c.ipc.length,0);
 const raw=readFileSync(new URL('./administrative-http.ts',import.meta.url),'utf8');assert.equal(raw.includes('localStorage'),false);assert.equal(raw.includes('sessionStorage'),false);
});
