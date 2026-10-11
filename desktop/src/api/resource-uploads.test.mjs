import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function load(options={}){
  const calls=[],http=[],exports={};let current=true;
  const source=ts.transpileModule(readFileSync(new URL('./resource-uploads.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,Uint8Array,AbortController,setTimeout,clearTimeout,require:p=>{
    if(p==='./auth')return {captureAccountSession:()=>options.signedOut?null:{accountId:'account'},isAccountSessionCurrent:()=>current};
    if(p==='@tauri-apps/api/tauri')return{convertFileSrc:(path,scheme)=>`http://${scheme}.localhost/${encodeURIComponent(path)}`};
    if(p==='./local-backend')return {localBackend:{invoke:async(command,args)=>{
      calls.push({command,args});if(options.failAt===command)throw Error('LOCAL_FAILED');
      if(options.switchAt===command)current=false;
      if(command==='local_authorization_guard')return 'native-session';
      if(command==='begin_local_resource_upload')return {change_id:`change-${calls.filter(c=>c.command===command).length}`};
      if(command==='finish_local_resource_upload')return {id:'resource',kind:'file'};
      if(command==='finish_local_resource_upload_batch')return args.changeIds.map((id,i)=>({id:`resource-${i}`,kind:'file'}));
      if(command==='read_local_resource_upload_chunk')return [1,2,3];
      if(command==='local_resource_file_access')return {resource:{path:'resource.capability',pending:true}};
    }}};
    if(p==='./http')return {getApiErrorMessage:async()=> 'NETWORK_FAILED',apiFetch:async(path,init)=>{
      http.push({path,init});if(options.networkFail)throw Error('NETWORK_FAILED');
      return{ok:true,json:async()=>options.status??{next_offset:0,initialized:false,published:false}};
    }};
    throw Error(p);
  }});return {api:exports,calls,http,switch:()=>{current=false;}};
}
const file={name:'test.txt',type:'text/plain',size:3,slice:()=>({arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer})};
const change={change_id:'change',entity_type:'resource',entity_id:'resource',operation:'create',payload:{resource:{id:'resource',kind:'file'},upload:{protocol:1,size_bytes:3,sha256:'a'.repeat(64)}}};

test('saving a desktop upload uses native staging then finalization and never HTTP',async()=>{
  const c=load(),progress=[];const r=await c.api.stageResourceFile(file,{},n=>progress.push(n));
  assert.equal(r.id,'resource');assert.equal(c.http.length,0);
  assert.deepEqual(c.calls.map(x=>x.command),['local_authorization_guard','begin_local_resource_upload','write_local_resource_upload_chunk','finish_local_resource_upload']);
  assert.equal(c.calls[2].args.expectedSessionToken,'native-session');assert.equal(progress.at(-1),100);
});
test('native failure never falls back to a server write or falsely completes',async()=>{
  for(const failAt of ['begin_local_resource_upload','write_local_resource_upload_chunk','finish_local_resource_upload']){
    const c=load({failAt}),progress=[];await assert.rejects(c.api.stageResourceFile(file,{},n=>progress.push(n)),/LOCAL_FAILED/);
    assert.equal(c.http.length,0);assert.ok(!progress.includes(100));
  }
});
test('sign-out/account switch stops staging before finalization',async()=>{
  const absent=load({signedOut:true});await assert.rejects(absent.api.stageResourceFile(file,{}),/Sign in/);assert.equal(absent.calls.length,0);
  const changed=load({switchAt:'write_local_resource_upload_chunk'});await assert.rejects(changed.api.stageResourceFile(file,{}),/Account changed/);
  assert.ok(!changed.calls.some(c=>c.command==='finish_local_resource_upload'));
});
test('empty file is finalized locally without a fabricated data chunk',async()=>{
  const c=load();await c.api.stageResourceFile({...file,size:0},{});
  assert.ok(!c.calls.some(x=>x.command==='write_local_resource_upload_chunk'));assert.equal(c.http.length,0);
});
test('sync transfers stable identity and exact bounded bytes; network failure preserves native state',async()=>{
  const c=load();await c.api.transferResourceUpload(change,'account','native-session',()=>{});
  assert.equal(c.http[1].init.headers['X-Resource-Id'],'resource');assert.equal(c.http[1].init.headers['X-Chunk-Offset'],'0');
  assert.deepEqual([...c.http[1].init.body],[1,2,3]);assert.equal(c.calls[0].args.changeId,'change');
  const failed=load({networkFail:true});await assert.rejects(failed.api.transferResourceUpload(change,'account','native-session',()=>{}),/NETWORK_FAILED/);
  assert.ok(!failed.calls.some(x=>x.command.includes('delete')||x.command.includes('synced')));
});
test('confirmed transfer resumes without replaying acknowledged bytes; invalid offsets fail closed',async()=>{
  const complete=load({status:{next_offset:3,initialized:true,published:false}});await complete.api.transferResourceUpload(change,'account','native-session',()=>{});assert.equal(complete.calls.length,0);assert.equal(complete.http.length,1);
  const invalid=load({status:{next_offset:2,initialized:true,published:false}});await assert.rejects(invalid.api.transferResourceUpload(change,'account','native-session',()=>{}),/Invalid server upload offset/);assert.equal(invalid.calls.length,0);
});
test('local media URLs are capabilities for the captured account session',async()=>{
  const c=load();await c.api.refreshLocalFileAccess();assert.equal(c.api.localFileUrl('resource'),'http://labos-file.localhost/resource.capability');assert.equal(c.api.localFilePending('resource'),true);
  c.switch();assert.equal(c.api.localFileUrl('resource'),null);assert.equal(c.api.localFilePending('resource'),false);
});

test('folder files stage completely before one native batch finalization, with no HTTP',async()=>{
  const c=load(),progress=[];
  const rows=await c.api.stageResourceFolderFiles('folder',[file,{...file,name:'two.txt'}],['one/test.txt','two.txt'],n=>progress.push(n));
  assert.equal(rows.length,2);assert.equal(c.http.length,0);
  assert.deepEqual(c.calls.map(x=>x.command),['local_authorization_guard','begin_local_resource_upload','write_local_resource_upload_chunk','begin_local_resource_upload','write_local_resource_upload_chunk','finish_local_resource_upload_batch']);
  assert.equal(c.calls[1].args.metadata.relative_path,'one/test.txt');
  assert.equal(c.calls[3].args.metadata.parent_resource_id,'folder');
  assert.deepEqual([...c.calls.at(-1).args.changeIds],['change-1','change-2']);
  assert.equal(progress.at(-1),100);
});

test('invalid or duplicate folder paths fail before any native staging',async()=>{
  for(const paths of [['../bad'],['/root'],['C:\\bad'],['a//b'],['a/./b'],['a\u0000b'],[''],[],['same','SAME']]){
    const c=load();const files=paths.length===2?[file,file]:[file];
    await assert.rejects(c.api.stageResourceFolderFiles('folder',files,paths));
    assert.equal(c.calls.length,0);assert.equal(c.http.length,0);
  }
  const c=load();assert.deepEqual([...c.api.validateFolderPaths([file],['dir\\file.txt'])],['dir/file.txt']);
});

test('failed folder staging never individually publishes files or reports completion',async()=>{
  for(const failAt of ['write_local_resource_upload_chunk','finish_local_resource_upload_batch']){
    const c=load({failAt}),progress=[];
    await assert.rejects(c.api.stageResourceFolderFiles('folder',[file,file],['one','two'],n=>progress.push(n)),/LOCAL_FAILED/);
    assert.equal(c.http.length,0);assert.ok(!progress.includes(100));
    assert.ok(!c.calls.some(c=>c.command==='finish_local_resource_upload'));
  }
});
