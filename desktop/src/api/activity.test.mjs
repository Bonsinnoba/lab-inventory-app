import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function load(options={}) {
  let current=true;const calls=[],requests=[];
  const exports={};
  const code=ts.transpileModule(readFileSync(new URL('./activity.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require:p=>{
    if(p==='./auth')return{captureAccountSession:()=>({accountId:'a'}),isAccountSessionCurrent:()=>current,getToken:()=> 'jwt',
      captureServerRequest:async()=>({accountId:'a',nativeSessionToken:'guard'}),isServerRequestCurrent:()=>current};
    if(p==='./local-backend')return{localBackend:{isAvailable:()=>true,invoke:async(command,args)=>{
      calls.push({command,args});if(options.nativeError)throw Error('LOCAL_READ_FAILURE');
      if(options.switchOnRead)current=false;
      return options.local??{items:[],state:'not_downloaded',last_synced_at:null,next_before:null};
    }}};
    if(p==='./http')return{getApiErrorMessage:async()=> 'HTTP_FAILURE',apiFetch:async path=>{
      requests.push(path);if(options.networkError)throw Error('NETWORK_FAILURE');
      if(options.switchOnResponse)current=false;
      return{ok:(options.status??200)===200,status:options.status??200,json:async()=>options.body??{records:[],snapshot_complete:true,snapshot_at:'2026-10-10T12:00:00Z'}};
    }};
    throw Error(p);
  }});
  return {api:exports,calls,requests};
}

test('activity local reads never invoke HTTP and preserve missing versus empty',async()=>{
  const missing=load();assert.equal((await missing.api.listActivity()).state,'not_downloaded');assert.equal(missing.requests.length,0);
  const empty=load({local:{items:[],state:'available',last_synced_at:'2026-10-10T12:00:00Z'}});
  assert.equal((await empty.api.listActivity()).state,'available');assert.equal(empty.requests.length,0);
  const broken=load({nativeError:true});await assert.rejects(broken.api.listActivity(),/LOCAL_READ_FAILURE/);assert.equal(broken.requests.length,0);
});

test('activity guard rejects account changes before publishing reads or pulls',async()=>{
  const reader=load({switchOnRead:true});await assert.rejects(reader.api.listActivity(),/Account changed/);
  const pull=load({switchOnResponse:true});await assert.rejects(pull.api.pullActivitySnapshot(),/Session changed/);assert.equal(pull.calls.length,0);
});

test('activity sync failure or incomplete snapshot never overwrites local snapshot',async()=>{
  for(const options of [{networkError:true},{status:500},{body:{records:[],snapshot_complete:false}}]) {
    const c=load(options);await assert.rejects(c.api.pullActivitySnapshot());assert.equal(c.calls.length,0);
  }
});

test('activity confirmed permission denial evicts only the captured account and session cache',async()=>{
  const c=load({status:403,body:{error:{code:'ADMIN_ROLE_REQUIRED'}}});await c.api.pullActivitySnapshot();
  assert.equal(c.calls.length,1);assert.equal(c.calls[0].args.snapshot,null);
  assert.equal(c.calls[0].args.expectedAccountId,'a');assert.equal(c.calls[0].args.expectedSessionToken,'guard');
  const unrelated=load({status:403,body:{error:{code:'ACCOUNT_DISABLED'}}});
  await assert.rejects(unrelated.api.pullActivitySnapshot());assert.equal(unrelated.calls.length,0);
});

test('activity complete empty snapshot can synchronize without becoming not-downloaded',async()=>{
  const c=load();assert.equal(await c.api.pullActivitySnapshot(),true);
  assert.equal(c.calls[0].command,'apply_server_activity_snapshot');assert.equal(c.calls[0].args.snapshot.snapshot_complete,true);
});
