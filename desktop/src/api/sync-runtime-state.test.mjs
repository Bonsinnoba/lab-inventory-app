import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

const compile=name=>ts.transpileModule(readFileSync(new URL(name,import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const storeModule={};vm.runInNewContext(compile('./sync-runtime-state.ts'),{exports:storeModule});
function fixture(){
  let session={accountId:'a',token:'token-a',generation:1},time=1000000;
  const data=new Map();
  const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const options={storage:()=>storage,session:()=>session,isCurrent:s=>!!s&&!!session&&s.accountId===session.accountId&&s.token===session.token&&s.generation===session.generation,now:()=>time};
  return {data,storage,options,store:storeModule.createSyncRuntimeStore(options),session:()=>session,
    switchTo:(id,generation=2)=>{session=id?{accountId:id,token:`token-${id}`,generation}:null;},advance:ms=>time+=ms};
}

test('accounts retain independent status and retry clocks across restart',()=>{
  const f=fixture(),a=f.session();
  f.store.publish(a,{status:'error',lastError:'A private error'});f.store.scheduleRetry(a);
  assert.equal(f.store.retryDue(),false);
  f.switchTo('b');assert.equal(f.store.getState().lastError,null);assert.equal(f.store.retryDue(),true);
  f.store.publish(f.session(),{status:'idle',lastSuccessAt:'2026-10-23T00:00:00Z'});
  f.switchTo('a',3);assert.equal(f.store.getState().lastError,'A private error');
  const restarted=storeModule.createSyncRuntimeStore(f.options);
  assert.equal(restarted.retryDue(),false);assert.equal(restarted.getState().lastError,'A private error');
  f.advance(5000);assert.equal(restarted.retryDue(),true);
});
test('late account or login-generation writes cannot publish, delay or clear current retry',()=>{
  const f=fixture(),old=f.session();f.switchTo('a',2);
  f.store.scheduleRetry(f.session());
  f.store.clearRetry(old);f.store.publish(old,{lastError:'stale'});
  assert.equal(f.store.retryDue(),false);assert.equal(f.store.getState().lastError,null);
  f.switchTo('b');f.store.scheduleRetry(old);assert.equal(f.store.retryDue(),true);
});
test('logout clears visible state and subscribers; unowned legacy keys are ignored and retained',()=>{
  const f=fixture();f.data.set('labos.sync.status.v1',JSON.stringify({lastError:'legacy secret'}));
  f.data.set('labos.sync.retry.v1',JSON.stringify({retryAt:9999999999,streak:5}));
  assert.equal(f.store.getState().lastError,null);assert.equal(f.store.retryDue(),true);
  const seen=[];const unsubscribe=f.store.subscribe(s=>seen.push(s));
  f.store.publish(f.session(),{lastError:'owned',status:'error'});
  f.switchTo(null);f.store.refresh();assert.equal(seen.at(-1).lastError,null);
  assert.equal(f.data.has('labos.sync.status.v1'),true);unsubscribe();
});
test('corrupt operational storage and storage failures do not prevent sync',()=>{
  const f=fixture();f.data.set('labos.sync.account.v2:a','not json');
  assert.equal(f.store.retryDue(),true);assert.equal(f.store.getState().lastError,null);
  const store=storeModule.createSyncRuntimeStore({...f.options,storage:()=>{throw Error('blocked');}});
  store.publish(f.session(),{status:'syncing'});store.scheduleRetry(f.session());
  assert.equal(store.getState().status,'syncing');assert.equal(store.retryDue(),false);
});
test('persisted retry delay is bounded and transient syncing is never restored',()=>{
  const f=fixture();f.data.set('labos.sync.account.v2:a',JSON.stringify({status:'syncing',retryAt:9999999999999,streak:9999,lastSuccessAt:'invalid'}));
  assert.equal(f.store.getState().status,'idle');assert.equal(f.store.getState().lastSuccessAt,null);
  assert.equal(f.store.retryDue(),false);f.advance(300000);assert.equal(f.store.retryDue(),true);
});

function loadSync(f,invoke){
  const exports={};
  const auth={captureAccountSession:f.session,isAccountSessionCurrent:f.options.isCurrent,getToken:()=>f.session()?.token,getStoredUser:()=>f.session()?{id:f.session().accountId}:null};
  const client={};
  vm.runInNewContext(compile('./sync-conflict-client.ts'),{exports:client,require:name=>{
    if(name==='./auth')return auth;
    if(name==='@tauri-apps/api/tauri')return{invoke};
    throw Error(name);
  }});
  vm.runInNewContext(compile('./sync.ts'),{exports,localStorage:f.storage,navigator:{onLine:true},window:{addEventListener(){},dispatchEvent(){}},require:name=>{
    if(name==='./auth')return auth;
    if(name==='./sync-runtime-state')return storeModule;
    if(name==='./sync-conflict-client')return client;
    if(name==='@tauri-apps/api/tauri')return{invoke};
    return {};
  }});
  return exports;
}
test('sync switched during preflight cannot start pulling or publish into new account',async()=>{
  const f=fixture();let release;const commands=[];
  const api=loadSync(f,async command=>{commands.push(command);await new Promise(r=>release=r);return{pending_sync_count:0,unassigned_pending_sync_count:0,unassigned_state_count:0};});
  const run=api.syncPendingChanges(true);f.switchTo('b');release();
  await assert.rejects(run,/Account changed/);
  assert.deepEqual(commands,['get_local_sync_queue_status']);assert.equal(api.getSyncRuntimeState().lastError,null);
});
test('late pending-queue failure does not leak error or share old run with new account',async()=>{
  const f=fixture();let rejectPending;let ready;const started=new Promise(r=>ready=r);
  const api=loadSync(f,async command=>{
    if(command==='get_local_sync_queue_status')return{pending_sync_count:0,unassigned_pending_sync_count:0,unassigned_state_count:0};
    return new Promise((_,reject)=>{rejectPending=reject;ready();});
  });
  const run=api.syncPendingChanges(true);await started;f.switchTo('b');
  await assert.rejects(api.syncPendingChanges(true),/Previous login/);
  rejectPending(Error('A private queue failure'));await run;
  assert.equal(api.getSyncRuntimeState().lastError,null);
  assert.equal(f.data.has('labos.sync.account.v2:b'),false);
});

test('failed or malformed preflight stops before pending reads, transfer or server calls',async()=>{
  for(const result of [null,{}, {pending_sync_count:0,unassigned_pending_sync_count:-1,unassigned_state_count:0},Error('SQLite locked')]){
    const f=fixture(),commands=[];
    const api=loadSync(f,async command=>{commands.push(command);if(result instanceof Error)throw result;return result;});
    assert.equal(await api.syncPendingChanges(true),0);
    assert.deepEqual(commands,['get_local_sync_queue_status']);
    assert.match(api.getSyncRuntimeState().lastError,/Local sync preflight unavailable/);
    // Automatic ticks respect backoff. Explicit retry tries preflight again,
    // but never bypasses it or pretends there are no unattributed changes.
    await api.syncPendingChanges();assert.equal(commands.length,1);
    await api.syncPendingChanges(true);assert.equal(commands.length,2);
  }
});
test('known unattributed changes still pause sync without being adopted or discarded',async()=>{
  const f=fixture(),commands=[];
  const api=loadSync(f,async command=>{commands.push(command);return{pending_sync_count:2,unassigned_pending_sync_count:1,unassigned_state_count:0};});
  assert.equal(await api.syncPendingChanges(true),0);
  assert.deepEqual(commands,['get_local_sync_queue_status']);
  assert.match(api.getSyncRuntimeState().lastError,/no verified account owner/);
});
test('public count helpers propagate read failures rather than returning false zeros',async()=>{
  const f=fixture();const api=loadSync(f,async()=>{throw Error('native unavailable');});
  for(const name of ['getPendingSyncCount','getUnassignedSyncCount','getUnassignedStateCount','getSyncConflictCount']){
    await assert.rejects(api[name](),/native unavailable/);
  }
});
