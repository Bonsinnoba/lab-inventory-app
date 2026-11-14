import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load({native=true,protocol=1,cancelProtocol=1,switchAt,fail=false,signedOut=false,standaloneProtocol=1,retentionProtocol=1,repairSupported=true}={}){
 const exports={},calls=[];let current=true;
 const source=ts.transpileModule(readFileSync(new URL('./recovery.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports,require:name=>{
  if(name==='../lib/runtime')return{isTauriRuntime:()=>native};
  if(name==='./auth')return{captureAccountSession:()=>signedOut?null:({accountId:'owner'}),isAccountSessionCurrent:()=>current};
  if(name==='@tauri-apps/api/tauri')return{invoke:async(command,args)=>{calls.push({command,args});if(command===switchAt)current=false;if(command==='standalone_recovery_status')return{protocol:standaloneProtocol,supported:true,working_key_repair_supported:repairSupported,busy:false,can_cancel:false};if(command==='local_startup_status')return{ready:false,message:'Workspace recovery required'};if(command==='local_database_status')return{recovery_backup_protocol:protocol,recovery_cancel_protocol:cancelProtocol,recovery_retention_protocol:retentionProtocol};if(command==='local_authorization_guard')return'native-token';if(fail)throw Error('disk unavailable');return ['cancel_local_recovery_operation','cancel_standalone_recovery'].includes(command)?true:{cancelled:false};}};
  throw Error(`Unexpected transport: ${name}`);
 }});return{api:exports,calls};
}
test('recovery commands carry only the frozen owner/session and explicit secret to native',async()=>{
 for(const [api,command] of [['createRecoveryBackup','create_local_recovery_backup'],['restoreRecoveryPackage','restore_local_recovery_package'],['recoverRecoveryKey','recover_local_recovery_key']]){
  const c=load();await c.api[api]('separate recovery secret');
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls.at(-1))),{command,args:{expectedAccountId:'owner',expectedSessionToken:'native-token',recoverySecret:'separate recovery secret'}});
  assert.equal(c.calls.length,3);
 }
 const c=load();await c.api.getRecoveryStatus();assert.equal(c.calls.at(-1).args.recoverySecret,undefined);
});
test('cancellation is separately gated and sends no secret or renderer destination',async()=>{
 const c=load();assert.equal(await c.api.cancelRecoveryOperation(),true);assert.deepEqual(JSON.parse(JSON.stringify(c.calls.at(-1).args)),{expectedAccountId:'owner',expectedSessionToken:'native-token'});
 const old=load({cancelProtocol:0});await assert.rejects(old.api.cancelRecoveryOperation(),/updated desktop/);assert.equal(old.calls.length,1);
});
test('old binaries, web runtime, disk failures and account switches never fall back',async()=>{
 for(const option of [{native:false},{protocol:0},{fail:true},...['local_database_status','local_authorization_guard','create_local_recovery_backup'].map(switchAt=>({switchAt}))]){
  const c=load(option);await assert.rejects(c.api.createRecoveryBackup('separate recovery secret'),/desktop|Account changed|disk unavailable/);
  if(option.protocol===0||option.switchAt==='local_database_status')assert.equal(c.calls.length,1);
  if(option.switchAt==='local_authorization_guard')assert.equal(c.calls.length,2);
 }
});

test('standalone recovery works signed out without opening SQLite or minting a login',async()=>{
 const c=load({signedOut:true});await c.api.restoreStandaloneRecovery('owner recovery secret');assert.deepEqual(c.calls.map(row=>row.command),['standalone_recovery_status','restore_standalone_recovery_package']);assert.deepEqual(JSON.parse(JSON.stringify(c.calls[1].args)),{recoverySecret:'owner recovery secret'});
 const status=await c.api.getWorkspaceStartupStatus();assert.equal(status.ready,false);assert.equal(await c.api.cancelStandaloneRecovery(),true);
 assert.ok(c.calls.every(row=>!['local_database_status','local_authorization_guard','local_login'].includes(row.command)));
});
test('standalone old binaries and browsers cannot fall back to server or account recovery',async()=>{
 for(const options of [{native:false},{standaloneProtocol:0}]){const c=load(options);await assert.rejects(c.api.restoreStandaloneRecovery('separate secret'),/desktop/);assert.ok(c.calls.length<=1);}
 const c=load({native:false});assert.equal((await c.api.getWorkspaceStartupStatus()).ready,true);assert.equal(c.calls.length,0);
});
test('activation accepts only a native opaque review ticket, never a renderer path or password',async()=>{
 const c=load({signedOut:true}),id='12345678-1234-4234-8234-123456789abc';await c.api.activateStandaloneRecovery(id);assert.deepEqual(JSON.parse(JSON.stringify(c.calls.at(-1))),{command:'activate_recovered_workspace',args:{activationTicket:id}});
 await assert.rejects(c.api.activateStandaloneRecovery('C:/arbitrary/folder'),/review/);assert.equal(c.calls.filter(row=>row.command==='activate_recovered_workspace').length,1);
});

test('retention is owner/session fenced and never accepts renderer file paths',async()=>{
 const c=load();await c.api.listRecoveryBackups();const id='12345678-1234-4234-8234-123456789abc';await c.api.pruneRecoveryBackup(id);assert.deepEqual(JSON.parse(JSON.stringify(c.calls.at(-1).args)),{backupId:id,expectedAccountId:'owner',expectedSessionToken:'native-token'});await assert.rejects(c.api.pruneRecoveryBackup('C:/important-file'),/registered backup/);
 const old=load({retentionProtocol:0});await assert.rejects(old.api.listRecoveryBackups(),/updated desktop/);assert.equal(old.calls.length,1);
 const switched=load({switchAt:'prune_local_recovery_backup'});await assert.rejects(switched.api.pruneRecoveryBackup(id),/Account changed/);
});

test('current-key repair uses the verified native ticket and never sends replacement rows or file paths',async()=>{const c=load({signedOut:true}),id='12345678-1234-4234-8234-123456789abc';await c.api.repairCurrentWorkspaceKey(id);assert.deepEqual(JSON.parse(JSON.stringify(c.calls.at(-1))),{command:'repair_current_workspace_key',args:{activationTicket:id}});await assert.rejects(c.api.repairCurrentWorkspaceKey('C:/unverified'),/review/);assert.equal(c.calls.filter(row=>row.command==='repair_current_workspace_key').length,1);const browser=load({native:false});await assert.rejects(browser.api.repairCurrentWorkspaceKey(id),/desktop/);assert.equal(browser.calls.length,0);});

test('older non-encryption binaries cannot accept a current-key repair request',async()=>{const c=load({repairSupported:false});await assert.rejects(c.api.repairCurrentWorkspaceKey('12345678-1234-4234-8234-123456789abc'),/encryption-enabled/);assert.deepEqual(c.calls.map(row=>row.command),['standalone_recovery_status']);});
