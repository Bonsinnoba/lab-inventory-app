import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load({signedIn=true,invoke=async()=>[]}={}){
  let generation=0,calls=0;const exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./sync-conflict-client.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText,{exports,require:name=>{
    if(name==='@tauri-apps/api/tauri')return{invoke:async(...args)=>{calls++;return invoke(...args);}};
    if(name==='./auth')return{
      captureAccountSession:()=>signedIn?{accountId:'owner',generation}:null,
      isAccountSessionCurrent:s=>!!s&&signedIn&&s.generation===generation
    };
    throw Error(name);
  }});
  return {api:exports,switchAccount:()=>generation++,calls:()=>calls};
}

test('queue counts come from one native read and preserve actual zero',async()=>{
  const c=load({invoke:async(command,args)=>{
    assert.equal(command,'get_local_sync_queue_status');assert.equal(args.expectedAccountId,'owner');
    return{pending_sync_count:0,unassigned_pending_sync_count:2,unassigned_state_count:3};
  }});
  const counts=await c.api.readSyncQueueCounts();
  assert.equal(counts.pending,0);assert.equal(counts.unassigned,2);assert.equal(counts.unassignedState,3);
  assert.equal(c.calls(),1);
});
test('missing, malformed and failed status reads never become zero counts',async()=>{
  for(const value of [undefined,null,-1,1.5,'0',NaN]){
    const c=load({invoke:async()=>({pending_sync_count:value,unassigned_pending_sync_count:0,unassigned_state_count:0})});
    await assert.rejects(c.api.readSyncQueueCounts(),/incomplete/);
  }
  const failed=load({invoke:async()=>{throw Error('SQLite unavailable');}});
  await assert.rejects(failed.api.readSyncQueueCounts(),/SQLite unavailable/);
});
test('queue reads reject signed-out calls and late account-switch responses',async()=>{
  const absent=load({signedIn:false});await assert.rejects(absent.api.readSyncQueueCounts(),/Sign in/);
  assert.equal(absent.calls(),0);
  let c;c=load({invoke:async()=>{c.switchAccount();return{pending_sync_count:1,unassigned_pending_sync_count:0,unassigned_state_count:0};}});
  await assert.rejects(c.api.readSyncQueueCounts(),/Account changed/);
});
test('reads and resolutions bind the intended account to native IPC',async()=>{
  const seen=[];const c=load({invoke:async(command,args)=>{seen.push([command,args]);return[];}});
  await c.api.listSyncConflicts();await c.api.resolveSyncConflict('change','accept_server');
  assert.equal(seen[0][1].expectedAccountId,'owner');
  assert.equal(seen[1][1].expectedAccountId,'owner');assert.equal(seen[1][1].changeId,'change');
});
test('signed-out callers do not invoke native reads or mutations',async()=>{
  const c=load({signedIn:false});
  await assert.rejects(c.api.listSyncConflicts(),/Sign in/);
  await assert.rejects(c.api.resolveSyncConflict('change','dismiss'),/Sign in/);assert.equal(c.calls(),0);
});
test('late responses after account switch are not exposed or reported as success',async()=>{
  let c;c=load({invoke:async()=>{c.switchAccount();return[{payload:'old private work'}];}});
  await assert.rejects(c.api.listSyncConflicts(),/Account changed/);
  await assert.rejects(c.api.resolveSyncConflict('change','dismiss'),/Account changed/);
});
test('native denial never falls through to another transport',async()=>{
  const c=load({invoke:async()=>{throw Error('native account mismatch');}});
  await assert.rejects(c.api.listSyncConflicts(),/native account mismatch/);
  await assert.rejects(c.api.resolveSyncConflict('change','dismiss'),/native account mismatch/);
  assert.equal(c.calls(),2);
});
test('recovery index binds account and rejects stale or signed-out responses',async()=>{
  const absent=load({signedIn:false});
  await assert.rejects(absent.api.listProjectDeleteRecoveries(),/Sign in/);assert.equal(absent.calls(),0);
  let c;c=load({invoke:async(command,args)=>{
    assert.equal(command,'list_project_delete_recoveries');assert.equal(args.expectedAccountId,'owner');
    c.switchAccount();return{records:[],has_more:false};
  }});
  await assert.rejects(c.api.listProjectDeleteRecoveries(),/Account changed/);
});
