import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

const cached={id:'private-local-row',central_user_id:'server-account',username:'fixture',role:'member',created_at:''};
function load({invoke=async()=>null,fetch=async()=>{throw new TypeError('offline')},desktop=true}={}){
  const data=new Map(),calls=[],events=[];
  const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const modules={};
  const context={TypeError,DOMException,Error,Headers,FormData,AbortController,Event,setTimeout,clearTimeout,
    localStorage:storage,navigator:{onLine:true},window:{__TAURI_IPC__:desktop,setTimeout,clearTimeout,dispatchEvent:e=>events.push(e.type)},
    fetch:async(...args)=>{calls.push(args);return fetch(...args)}};
  function module(name){
    if(modules[name])return modules[name];
    const exports={};modules[name]=exports;
    const require=p=>p==='../lib/config'?{API_BASE:'http://fixture/api',API_TIMEOUT_MS:50}:p==='@tauri-apps/api/tauri'?{invoke}:p==='./auth'?module('auth'):p==='./http'?module('http'):(()=>{throw Error(p)})();
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`./${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{...context,exports,require});
    return exports;
  }
  return {auth:module('auth'),http:()=>module('http'),calls,events,storage};
}
test('actual auth adapter maps offline credential ID to server ID and preserves usable local session',async()=>{
  const ipc=[];const c=load({invoke:async(name)=>{ipc.push(name);return {user:cached,token:'local:opaque'}}});
  const result=await c.auth.login('fixture','fixture-password');
  assert.equal(result.user.id,'server-account');assert.equal(result.token,'local:opaque');
  c.auth.setToken(result.token);c.auth.setStoredUser(result.user);
  assert.equal(c.auth.captureAccountSession().accountId,'server-account');
  assert.ok(c.auth.isAccountSessionCurrent(c.auth.captureAccountSession()));
  assert.deepEqual(ipc,['cache_server_user']);
  assert.equal(c.calls.length,0);
});
test('cold restoration uses native validated session token and central identity, without HTTP',async()=>{
  const c=load({invoke:async()=>({authenticated:true,bootstrapped:true,user:cached,token:'local:restored'})});
  const result=await c.auth.getCurrentUser('local:');
  assert.equal(result.user.id,'server-account');assert.equal(result.token,'local:restored');assert.equal(c.calls.length,0);
});
test('expired or missing native session cannot restore even if an old token exists',async()=>{
  const c=load({invoke:async()=>({authenticated:false,bootstrapped:true,user:null,token:null})});
  await assert.rejects(c.auth.getCurrentUser('local:old'),/Sign in online again/);
});
test('contact profiles save offline through the guarded native writer with no HTTP or privilege fields',async()=>{
 const ipc=[];const c=load({invoke:async(name,args)=>{ipc.push([name,args]);if(name==='local_authorization_guard')return 'native-guard';if(name==='update_local_account_profile')return{profile:args.profile,pending_sync:true};throw Error(name);}});
 c.auth.setToken('local:offline');c.auth.setStoredUser({...cached,id:'server-account',display_name:'Before',email:null});const result=await c.auth.updateProfile('After','contact@example.test',{display_name:'Before',email:null});
 assert.equal(result.display_name,'After');assert.equal(result.role,'member');assert.equal(result.profile_pending_sync,true);assert.equal(c.calls.length,0);assert.equal(ipc[1][1].expectedSessionToken,'native-guard');assert.equal(ipc[1][1].serverToken,undefined);assert.deepEqual(Object.keys(ipc[1][1].profile).sort(),['display_name','email']);
});
test('failed local profile writes never fall back to HTTP and require a reviewed form base',async()=>{
 const c=load({invoke:async name=>{if(name==='local_authorization_guard')return 'native-guard';throw Error('disk unavailable');}});c.auth.setToken('local:offline');c.auth.setStoredUser({...cached,id:'server-account'});
 await assert.rejects(c.auth.updateProfile('A','a@example.test'),/Reopen/);await assert.rejects(c.auth.updateProfile('A','a@example.test',{display_name:null,email:null}),/disk unavailable/);assert.equal(c.calls.length,0);
});
test('expired server authentication retains identity for the locked same-account workspace but removes I/O authority',async()=>{
 const c=load({invoke:async()=> 'guard'});c.auth.setToken('jwt');c.auth.setStoredUser({...cached,id:'server-account'});const context=await c.auth.captureServerRequest('jwt');await c.auth.observeServerAuthResponse(authResponse(401,'INVALID_TOKEN'),context);assert.equal(c.auth.getToken(),null);assert.equal(c.auth.getStoredUser().id,'server-account');assert.equal(c.auth.captureAccountSession(),null);assert.equal(c.events.includes('labos:auth-expired'),true);
});
test('unlinked local account is never promoted to server identity',async()=>{
  const c=load({invoke:async()=>({user:{...cached,central_user_id:null},token:'local:x'})});
  await assert.rejects(c.auth.login('fixture','password'),/verified server identity/);
});
test('explicit server credential rejection never invokes offline password fallback',async()=>{
  const ipc=[];const c=load({invoke:async(name)=>{ipc.push(name);throw {code:'AUTH_REJECTED',message:'Invalid credentials'};}});
  await assert.rejects(c.auth.login('fixture','wrong'),/Invalid credentials/);
  assert.deepEqual(ipc,['cache_server_user']);assert.equal(c.calls.length,0);
});
test('network fallback restores central identity while retaining server credentials for reconnect',async()=>{
  const c=load({invoke:async()=>cached});c.auth.setToken('server-jwt');c.auth.setStoredUser({...cached,id:'server-account'});
  const result=await c.auth.getCurrentUser('server-jwt');
  assert.equal(result.user.id,'server-account');assert.equal(c.auth.getToken(),'server-jwt');
});
test('native session for another account cannot replace a failed server session',async()=>{
  const c=load({invoke:async()=>({...cached,central_user_id:'other'})});
  c.auth.setStoredUser({...cached,id:'server-account'});
  await assert.rejects(c.auth.getCurrentUser('server-jwt'),/another account/);
});
test('sign-out and same-account re-entry invalidates previously captured work',()=>{
  const c=load();c.auth.setToken('local:x');c.auth.setStoredUser({...cached,id:'server-account'});
  const first=c.auth.captureAccountSession();c.auth.removeToken();c.auth.setToken('local:x');
  assert.equal(c.auth.isAccountSessionCurrent(first),false);
  assert.equal(c.auth.isAccountSessionCurrent(c.auth.captureAccountSession()),true);
});
test('server-only feature cannot transmit local credentials or destroy offline login',async()=>{
  const c=load();c.auth.setToken('local:x');c.auth.setStoredUser({...cached,id:'server-account'});
  await assert.rejects(c.http().apiFetch('/assistant/conversations'),/online sign-in/);
  assert.equal(c.calls.length,0);assert.equal(c.auth.getToken(),'local:x');assert.equal(c.events.includes('labos:auth-expired'),false);
});
test('late 401 from an old server request cannot clear a new account session',async()=>{
  let complete;const c=load({fetch:()=>new Promise(resolve=>complete=resolve)});
  c.auth.setToken('old');const pending=c.http().apiFetch('/reports/overview');
  while(!complete) await new Promise(resolve=>setTimeout(resolve,0));
  c.auth.setToken('new');c.auth.setStoredUser({...cached,id:'new-account'});
  complete({ok:false,status:401});await pending;
  assert.equal(c.auth.getToken(),'new');assert.equal(c.auth.getStoredUser().id,'new-account');
});

const serverUser={...cached,id:'server-account'};
function authResponse(status,code){return new Response(JSON.stringify({error:{code,message:code}}),{status,headers:{'Content-Type':'application/json'}});}

test('confirmed server revocation locks only the captured native session before expiring UI',async()=>{
  const ipc=[];const c=load({fetch:async()=>authResponse(401,'SESSION_REVOKED'),invoke:async(name,args)=>{
    ipc.push({name,args});return name==='local_authorization_guard'?'native-guard':true;
  }});
  c.auth.setToken('jwt');c.auth.setStoredUser(serverUser);
  await c.http().apiFetch('/sync/projects/pull');
  assert.equal(ipc[1].name,'invalidate_local_authorization');
  assert.equal(ipc[1].args.expectedAccountId,'server-account');
  assert.equal(ipc[1].args.expectedSessionToken,'native-guard');
  assert.equal(c.auth.getToken(),null);assert.equal(c.events.includes('labos:auth-expired'),true);
});

test('ordinary JWT expiry never revokes the valid offline cache',async()=>{
  const ipc=[];const c=load({fetch:async()=>authResponse(401,'INVALID_TOKEN'),invoke:async(name)=>{ipc.push(name);return 'guard';}});
  c.auth.setToken('jwt');c.auth.setStoredUser(serverUser);
  await c.http().apiFetch('/reports/overview');
  assert.deepEqual(ipc,['local_authorization_guard','local_database_status']);assert.equal(c.auth.getToken(),null);
});

test('expired server bearer is removed from protected storage without revoking offline authority',async()=>{
 const ipc=[];const c=load({fetch:async()=>authResponse(401,'INVALID_TOKEN'),invoke:async(name,args)=>{ipc.push({name,args});if(name==='local_database_status')return{protected_credentials_protocol:1};return name==='local_authorization_guard'?'guard':true;}});
 c.auth.setToken('jwt');c.auth.setStoredUser(serverUser);await c.http().apiFetch('/reports/overview');
 assert.deepEqual(ipc.map(c=>c.name),['local_authorization_guard','local_database_status','forget_local_server_credential']);
 assert.equal(ipc.at(-1).args.expectedSessionToken,'guard');assert.equal(c.auth.getToken(),null);
});

test('explicit online sign-in retains identity and native authority and rejects stale login generations',()=>{
 const ipc=[];const c=load({invoke:async name=>{ipc.push(name);}});c.auth.setStoredUser(serverUser);c.auth.setToken('local:native-session');
 const original=c.auth.captureAccountSession();assert.equal(c.auth.requestOnlineSignIn(original),true);assert.equal(c.auth.getToken(),null);assert.equal(c.auth.getStoredUser().id,serverUser.id);assert.equal(c.events.includes('labos:auth-expired'),true);assert.equal(ipc.length,0);
 c.auth.setToken('local:new-session');assert.equal(c.auth.requestOnlineSignIn(original),false);assert.equal(c.auth.getToken(),'local:new-session');
 c.auth.setToken('server-token');assert.equal(c.auth.requestOnlineSignIn(c.auth.captureAccountSession()),false);assert.equal(c.auth.getToken(),'server-token');
});

test('a native login that changed during HTTP cannot be locked by the old response',async()=>{
  const c=load({fetch:async()=>authResponse(401,'ACCOUNT_DISABLED'),invoke:async(name)=>name==='local_authorization_guard'?'old-guard':false});
  c.auth.setToken('jwt');c.auth.setStoredUser(serverUser);
  await c.http().apiFetch('/reports/overview');
  assert.equal(c.auth.getToken(),'jwt');assert.equal(c.events.includes('labos:auth-expired'),false);
});

test('successful self-password change locks cached old credentials and requests sign-in',async()=>{
  const ipc=[];const c=load({fetch:async()=>new Response(JSON.stringify({reauthentication_required:true})),invoke:async(name)=>{ipc.push(name);return name==='local_authorization_guard'?'guard':true;}});
  c.auth.setToken('jwt');c.auth.setStoredUser(serverUser);
  await c.auth.changePassword('fixture-old','fixture-new');
  assert.equal(ipc.filter(name=>name==='invalidate_local_authorization').length,1);
  assert.equal(c.auth.getToken(),null);assert.equal(c.events.includes('labos:auth-expired'),true);
});

test('a server 503 preserves the current session and never locks offline access',async()=>{
  const ipc=[];const c=load({fetch:async()=>authResponse(503,'AUTH_UNAVAILABLE'),invoke:async(name)=>{ipc.push(name);return 'guard';}});
  c.auth.setToken('jwt');c.auth.setStoredUser(serverUser);
  assert.equal((await c.http().apiFetch('/reports/overview')).status,503);
  assert.deepEqual(ipc,['local_authorization_guard']);assert.equal(c.auth.getToken(),'jwt');
});

test('a late same-account response after sign-out/re-entry cannot revoke a new session',async()=>{
  let complete;const ipc=[];const c=load({fetch:()=>new Promise(resolve=>complete=resolve),invoke:async(name)=>{ipc.push(name);return 'guard';}});
  c.auth.setToken('jwt');c.auth.setStoredUser(serverUser);
  const pending=c.http().apiFetch('/reports/overview');
  while(!complete) await new Promise(resolve=>setTimeout(resolve,0));
  c.auth.removeToken();c.auth.setToken('jwt');c.auth.setStoredUser(serverUser);
  complete(authResponse(401,'SESSION_REVOKED'));await pending;
  assert.deepEqual(ipc,['local_authorization_guard']);assert.equal(c.auth.getToken(),'jwt');
});

test('online login bootstrap never publishes the new token with the previous account',async()=>{
  const observed=[];let c;
  c=load({invoke:async(name,args)=>{observed.push([name,c.auth.getToken(),c.auth.getStoredUser()?.id]);assert.deepEqual(Object.keys(args).sort(),['password','username']);return {user:{...serverUser,id:'next-account',central_user_id:'next-account'},token:'next-jwt'};}});
  c.auth.setToken('previous-jwt');c.auth.setStoredUser(serverUser);
  const result=await c.auth.login('fixture','fixture-password');
  assert.equal(result.token,'next-jwt');
  assert.deepEqual(observed,[['cache_server_user','previous-jwt','server-account']]);
});

test('startup during authentication-service outage retains authorized native identity',async()=>{
  const c=load({fetch:async()=>authResponse(503,'AUTH_UNAVAILABLE'),invoke:async(name)=>name==='local_authorization_guard'?'guard':cached});
  c.auth.setToken('jwt');c.auth.setStoredUser(serverUser);
  assert.equal((await c.auth.getCurrentUser('jwt')).user.id,'server-account');
  assert.equal(c.auth.getToken(),'jwt');assert.equal(c.events.includes('labos:auth-expired'),false);
});

test('native refresh revocation after successful me cannot restore the authenticated UI',async()=>{
  const c=load({fetch:async()=>new Response(JSON.stringify({user:serverUser})),invoke:async(name)=>{
    if(name==='local_authorization_guard')return 'guard';
    if(name==='local_current_user')return cached;
    if(name==='cache_server_permissions')throw 'AUTH_REVOKED: cached access revoked';
    throw Error('Unexpected IPC '+name);
  }});
  c.auth.setToken('jwt');c.auth.setStoredUser(serverUser);
  await assert.rejects(c.auth.getCurrentUser('jwt'),/Session changed/);
  assert.equal(c.auth.getToken(),null);assert.equal(c.events.includes('labos:auth-expired'),true);
});

test('healthy server JWT cannot restore a desktop whose native lease expired',async()=>{
  const ipc=[];
  const c=load({fetch:async()=>new Response(JSON.stringify({user:serverUser})),invoke:async(name)=>{
    ipc.push(name);if(name==='local_authorization_guard')return 'guard';
    if(name==='local_current_user')return null;
    throw Error('Unexpected IPC '+name);
  }});
  c.auth.setToken('jwt');c.auth.setStoredUser(serverUser);
  await assert.rejects(c.auth.getCurrentUser('jwt'),/Sign in online again/);
  assert.equal(ipc.includes('cache_server_permissions'),false);
  // Only the startup UI decides to show sign-in; this check neither logs out
  // native auth nor invalidates/deletes the cache, lease, outbox or business rows.
  assert.equal(c.auth.getToken(),'jwt');assert.equal(c.events.includes('labos:auth-expired'),false);
});

test('healthy server and matching native lease restore despite transient permission-refresh failure',async()=>{
  const c=load({fetch:async()=>new Response(JSON.stringify({user:serverUser})),invoke:async(name)=>{
    if(name==='local_authorization_guard')return 'guard';
    if(name==='local_current_user')return cached;
    if(name==='cache_server_permissions')throw Error('temporary network outage');
    throw Error(name);
  }});
  c.auth.setToken('jwt');c.auth.setStoredUser(serverUser);
  assert.equal((await c.auth.getCurrentUser('jwt')).user.id,'server-account');
});

test('server success cannot restore a different native account',async()=>{
  const c=load({fetch:async()=>new Response(JSON.stringify({user:serverUser})),invoke:async(name)=>
    name==='local_authorization_guard'?'guard':{...cached,central_user_id:'other'}});
  c.auth.setToken('jwt');c.auth.setStoredUser(serverUser);
  await assert.rejects(c.auth.getCurrentUser('jwt'),/another account/);
});

test('late native lease response cannot restore or clear a newer login',async()=>{
  let complete;
  const c=load({fetch:async()=>new Response(JSON.stringify({user:serverUser})),invoke:async(name)=>
    name==='local_authorization_guard'?'guard':new Promise(resolve=>complete=resolve)});
  c.auth.setToken('jwt');c.auth.setStoredUser(serverUser);
  const pending=c.auth.getCurrentUser('jwt');
  while(!complete)await new Promise(resolve=>setTimeout(resolve,0));
  c.auth.setToken('new-jwt');c.auth.setStoredUser({...serverUser,id:'other'});
  complete(null);await assert.rejects(pending,/Session changed/);
  assert.equal(c.auth.getToken(),'new-jwt');assert.equal(c.auth.getStoredUser().id,'other');
});


test('desktop bearer tokens are memory-only and legacy WebView tokens are purged; browser storage remains supported',()=>{
 const desktop=load();desktop.storage.setItem('auth_token','legacy-bearer');assert.equal(desktop.auth.getToken(),null);assert.equal(desktop.storage.getItem('auth_token'),null);
 desktop.auth.setToken('online-bearer');assert.equal(desktop.auth.getToken(),'online-bearer');assert.equal(desktop.storage.getItem('auth_token'),null);desktop.auth.removeToken();assert.equal(desktop.auth.getToken(),null);
 const browser=load({desktop:false});browser.auth.setToken('browser-bearer');assert.equal(browser.storage.getItem('auth_token'),'browser-bearer');assert.equal(browser.auth.getToken(),'browser-bearer');
});
test('desktop restoration obtains a protected native bearer only alongside an authenticated native lease',async()=>{
 const c=load({invoke:async name=>{assert.equal(name,'local_auth_status');return{authenticated:true,bootstrapped:true,user:cached,token:'local:guard',server_token:'protected-online-bearer'};}});
 const result=await c.auth.getCurrentUser('local:');assert.equal(result.token,'protected-online-bearer');assert.equal(result.user.id,'server-account');
});

test('a fresh desktop does not claim its nonexistent cached session has expired',async()=>{const c=load({invoke:async name=>{assert.equal(name,'local_auth_status');return{authenticated:false,bootstrapped:false,user:null,token:null};}});await assert.rejects(c.auth.getCurrentUser('local:'),error=>error.message==='Sign in online to authorize this installation.'&&error.message!==c.auth.DESKTOP_REAUTH_REQUIRED);});
