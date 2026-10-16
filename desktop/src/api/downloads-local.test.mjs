import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load(options={}){
  const calls=[],http=[];let current=true;const exports={};
  const code=ts.transpileModule(readFileSync(new URL('./downloads-local.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require:p=>{
    if(p==='./auth')return{captureAccountSession:()=>options.signedOut?null:{accountId:'a'},isAccountSessionCurrent:()=>current,
      captureServerRequest:async()=>({accountId:'a',nativeSessionToken:'guard'}),isServerRequestCurrent:()=>current,getToken:()=> 'jwt'};
    if(p==='./local-backend')return{localBackend:{invoke:async(command,args)=>{
      calls.push({command,args});if(options.nativeStringError)throw options.nativeStringError;if(options.nativeError)throw Error('LOCAL_FAILURE');if(options.switchAccount)current=false;
      return options.value??{jobs:[],settings:null,snapshot_complete:false,last_synced_at:null};
    }}};
    if(p==='./download-presentation')return{downloadFailureMessage:(e,f)=>typeof e==='string'?e:e?.message||f};
    if(p==='./http')return{apiFetch:async path=>{http.push(path);if(options.networkError)throw Error('NETWORK_FAILURE');return{ok:options.status===undefined,status:options.status??200,json:async()=>options.body??{}}}};
    throw Error(p);
  }});return{api:exports,calls,http};
}
test('desktop scheduled enqueue is local and keeps its schedule',async()=>{
  const c=load({value:{id:'job'}});await c.api.enqueueLocalDownload('resource','720p','2026-12-10T12:00:00Z');
  assert.equal(c.calls[0].command,'queue_local_download');assert.equal(c.calls[0].args.scheduledFor,'2026-12-10T12:00:00Z');assert.equal(c.http.length,0);
});
test('local save failure never retries through a server write',async()=>{
  const c=load({nativeError:true});await assert.rejects(c.api.saveLocalDownloadSettings({enabled:false,sync_version:3}),/LOCAL_FAILURE/);assert.equal(c.http.length,0);
});

test('native string read failures remain errors, not missing snapshots or server fallbacks',async()=>{
  const c=load({nativeStringError:'no such column: o.rowid'});
  await assert.rejects(c.api.readDownloadSnapshot(),/no such column: o.rowid/);
  assert.equal(c.calls.length,1);assert.equal(c.http.length,0);
});
test('settings save carries expected version and only shared settings fields',async()=>{
  const c=load();await c.api.saveLocalDownloadSettings({enabled:false,sync_version:3,pending_sync:true,sync_conflict:false});
  assert.equal(c.calls[0].args.expectedVersion,3);assert.deepEqual(Object.keys(c.calls[0].args.patch),['enabled']);assert.equal(c.http.length,0);
});
test('signed-out and switched-account download reads are rejected',async()=>{
  const out=load({signedOut:true});await assert.rejects(out.api.readDownloadSnapshot(),/Sign in/);assert.equal(out.calls.length,0);
  const switched=load({switchAccount:true});await assert.rejects(switched.api.readDownloadSnapshot(),/Account changed/);
});
test('network failure preserves snapshot; verified permission denial evicts only captured cache',async()=>{
  const offline=load({networkError:true});await assert.rejects(offline.api.pullDownloadSnapshot());assert.equal(offline.calls.length,0);
  const denied=load({status:403,body:{error:{code:'PERMISSION_DENIED'}}});await denied.api.pullDownloadSnapshot();
  assert.equal(denied.calls[0].args.snapshot,null);assert.equal(denied.calls[0].args.expectedSessionToken,'guard');
});
test('control failure never falls back to HTTP; account switch rejects the result',async()=>{
  const job={id:'job',resource_id:'resource',control_version:4};
  const failed=load({nativeError:true});await assert.rejects(failed.api.controlLocalDownload(job,'cancel'),/LOCAL_FAILURE/);assert.equal(failed.http.length,0);
  const switched=load({switchAccount:true});await assert.rejects(switched.api.controlLocalDownload(job,'pause'),/Account changed/);
  const signedOut=load({signedOut:true});await assert.rejects(signedOut.api.controlLocalDownload(job,'remove'),/Sign in/);assert.equal(signedOut.calls.length,0);
});
test('control carries an immutable expected version and does not accept an unversioned job',async()=>{
  const c=load();await c.api.controlLocalDownload({id:'job',control_version:4},'edit',{quality:'480p',scheduled_for:null});
  assert.equal(c.calls[0].command,'control_local_download');assert.equal(c.calls[0].args.expectedVersion,4);
  assert.equal(c.calls[0].args.patch.scheduled_for,null);assert.equal(c.http.length,0);
  await assert.rejects(c.api.controlLocalDownload({id:'job'},'start'),/Synchronize/);assert.equal(c.calls.length,1);
});
