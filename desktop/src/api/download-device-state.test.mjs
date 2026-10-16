import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function load(options={}){
  const calls=[],exports={},session={accountId:'a',generation:1};let current=true;
  const resource={id:'r',kind:'link',file_type:'youtube',local_media_filename:'server.mp4'};
  const code=ts.transpileModule(readFileSync(new URL('./download-device-state.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require:p=>{
    if(p==='../lib/runtime')return{isTauriRuntime:()=>!options.browser};
    if(p==='./auth')return{captureAccountSession:()=>options.signedOut?null:session,isAccountSessionCurrent:s=>s===session&&current};
    if(p==='./local-backend')return{localBackend:{invoke:async(command,args)=>{
      calls.push({command,args});
      if(command==='list_local_resources'){
        if(options.metadataError)throw Error('Permission denied');
        if(options.switchAt==='metadata')current=false;
        return options.missing?[]:[resource];
      }
      if(command==='local_resource_copy_status'){
        if(options.switchAt==='copy')current=false;
        if(options.copyError)throw Error('Native status failed');
        return options.copy?{r:options.copy}:{};
      }
      throw Error('Unexpected command');
    }}};
    throw Error(`Forbidden dependency: ${p}`);
  }});return{api:exports,calls,expire:()=>{current=false;}};
}

test('server filename cannot establish PC availability; no HTTP dependency',async()=>{
  const c=load(),state=await c.api.readDownloadDeviceState();
  assert.match(c.api.downloadDeviceLabel(state,'r'),/not verified/);
  assert.deepEqual(c.calls.map(x=>x.command),['list_local_resources','local_resource_copy_status']);
  assert.equal(c.calls[1].args.expectedAccountId,'a');
});
test('only native ready status claims local availability',async()=>{
  const labels={ready:'available on this PC',copying:'Copying',needs_verification:'needs verification',stale:'older revision or server',incomplete:'incomplete',unexpected:'status unavailable'};
  for(const [state,label] of Object.entries(labels)){
    const c=load({copy:{state,verified_bytes:1,size_bytes:1}});
    assert.ok(c.api.downloadDeviceLabel(await c.api.readDownloadDeviceState(),'r').includes(label));
  }
});
test('failed native status remains unknown while retaining metadata',async()=>{
  const c=load({copyError:true}),state=await c.api.readDownloadDeviceState();
  assert.equal(state.resources.r.id,'r');assert.equal(state.copiesChecked,false);
  assert.equal(c.api.downloadDeviceLabel(state,'r'),'PC file status unavailable');
});
test('metadata permission failure cannot fall back to server or copy status',async()=>{
  const c=load({metadataError:true});await assert.rejects(c.api.readDownloadDeviceState(),/Permission denied/);assert.equal(c.calls.length,1);
});
test('account switches reject reads at either async boundary and invalidate saved presentation',async()=>{
  for(const switchAt of ['metadata','copy']){const c=load({switchAt});await assert.rejects(c.api.readDownloadDeviceState(),/Account changed/);}
  const c=load({copy:{state:'ready'}}),state=await c.api.readDownloadDeviceState();c.expire();
  assert.equal(c.api.downloadDeviceLabel(state,'r'),'PC file status unavailable');
});
test('missing local metadata and copy errors never claim a ready file',async()=>{
  const c=load({missing:true,copy:{state:'ready'}});
  assert.match(c.api.downloadDeviceLabel(await c.api.readDownloadDeviceState(),'r'),/not available in this local view/);
  const d=load({copy:{state:'copying',error:'network'}});
  assert.match(d.api.downloadDeviceLabel(await d.api.readDownloadDeviceState(),'r'),/interrupted/);
});
test('browser and signed-out calls never read native data',async()=>{
  for(const options of [{browser:true},{signedOut:true}]){const c=load(options);await assert.rejects(c.api.readDownloadDeviceState());assert.equal(c.calls.length,0);}
});
