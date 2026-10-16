import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

const report={checked_at:'2026-10-14T12:00:00.000Z',production:false,yt_dlp:{available:true,path:'yt-dlp'},ffmpeg:{available:false,path:'ffmpeg'},node:{available:true,path:'node'}};
function load(options={}){
  const calls=[],exports={};
  const code=ts.transpileModule(readFileSync(new URL('./mediaDownloads.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require:p=>{
    if(p==='../lib/runtime')return{isTauriRuntime:()=>!options.browser};
    if(p==='./auth')return{};
    if(p==='./download-enqueue-retry')return{};
    if(p==='./downloads-local')return{readDownloadSnapshot:async()=>{calls.push('local');if(options.error)throw Error(options.error);return{tools_status:options.missing?null:report};}};
    if(p==='./http')return{apiFetch:async path=>{calls.push(path);return{ok:true,json:async()=>report};}};
    throw Error(p);
  }});return{api:exports,calls};
}
test('desktop tool status reads only the saved native snapshot',async()=>{
  const c=load();const result=await c.api.getMediaToolsStatus();
  assert.equal(result.checked_at,report.checked_at);assert.equal(result.cached,true);assert.equal(result.ffmpeg.available,false);assert.deepEqual(c.calls,['local']);
  assert.equal(report.cached,undefined);
});
test('missing first check is unknown, never an HTTP fallback or false empty success',async()=>{
  const c=load({missing:true});await assert.rejects(c.api.getMediaToolsStatus(),/not been synchronized/);assert.deepEqual(c.calls,['local']);
});
test('native permission/session errors cannot fall through to server reads',async()=>{
  for(const error of ['Permission denied','Account changed','Lease expired']){
    const c=load({error});await assert.rejects(c.api.getMediaToolsStatus(),new RegExp(error));assert.deepEqual(c.calls,['local']);
  }
});
test('browser retains the server diagnostic endpoint',async()=>{
  const c=load({browser:true});assert.equal(await c.api.getMediaToolsStatus(),report);assert.deepEqual(c.calls,['/media-downloads/tools/status']);
});
