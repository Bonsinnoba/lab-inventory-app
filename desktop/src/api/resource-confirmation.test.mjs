import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load({protocol=1,mutationProtocol=1,fail=false,current=true}={}){
  const calls=[],exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./resource-confirmation.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>{
    if(name==='./auth')return {captureServerRequest:async()=>({accountId:'account',nativeSessionToken:'native-session'}),isServerRequestCurrent:()=>current};
    if(name==='@tauri-apps/api/tauri')return {invoke:async(command,args)=>{calls.push({command,args});if(command==='local_database_status')return{resource_confirmation_protocol:protocol,resource_mutation_confirmation_protocol:mutationProtocol};if(fail)throw Error('verification unavailable');}};
    throw Error(name);
  }});return{api:exports,calls};
}
test('confirmation passes identity and credentials, never renderer receipts or permissions',async()=>{
  const c=load();await c.api.confirmResourceChange('change','token',()=>{});
  assert.equal(c.calls[1].command,'confirm_local_resource_changes');
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls[1].args)),{expectedAccountId:'account',expectedSessionToken:'native-session',serverToken:'token',changeId:'change'});
});
test('old binary and failed verification never fall back to an unverified ACK',async()=>{
  const old=load({protocol:0});await assert.rejects(()=>old.api.confirmResourceChange('change','token',()=>{}),/updated desktop/);assert.equal(old.calls.length,1);
  const failed=load({fail:true});await assert.rejects(()=>failed.api.confirmResourceChange('change','token',()=>{}),/unavailable/);assert.equal(failed.calls.length,2);
});
test('changed sessions abort before confirmation; file sync returns without generic ACK',async()=>{
  const c=load({current:false});await assert.rejects(()=>c.api.confirmResourceChange('change','token',()=>{}),/session changed/);assert.equal(c.calls.length,1);
  const source=readFileSync(new URL('./sync.ts',import.meta.url),'utf8');
  assert.match(source,/if\(isResourceUpload\(change\)\)\{\s*await confirmResourceChange[\s\S]*?return;/);
  assert.doesNotMatch(source,/bind_local_resource_(edit|upload)_receipts/);
});
test('mutation confirmation sends only identity and session to native verifier',async()=>{
  const c=load();await c.api.confirmResourceMutation('change','token',()=>{});
  assert.equal(c.calls[1].command,'confirm_local_resource_mutation');
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls[1].args)),{expectedAccountId:'account',expectedSessionToken:'native-session',serverToken:'token',changeId:'change'});
  const source=readFileSync(new URL('./sync.ts',import.meta.url),'utf8');
  assert.match(source,/\['attach','edit_metadata'\].includes\(change.operation\)[\s\S]*?await confirmResourceMutation[\s\S]*?return;/);
});
test('old mutation verifier, failed server checks and account switches retain intent without generic ACK',async()=>{
  for(const options of [{mutationProtocol:0},{fail:true},{current:false}]){
    const c=load(options);await assert.rejects(c.api.confirmResourceMutation('change','token',()=>{}));
    assert.ok(c.calls.every(c=>['local_database_status','confirm_local_resource_mutation'].includes(c.command)));
  }
});
