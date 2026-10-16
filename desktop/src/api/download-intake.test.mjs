import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

const link=(id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',extra={})=>({id,name:'Saved video',kind:'link',url:'https://web.facebook.com/reel/123',created_at:'2026-10-16',...extra});
function load(options={}){
  const calls=[],exports={};let current=true;
  const rows=options.rows??[link()];
  const code=ts.transpileModule(readFileSync(new URL('./download-intake.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,URL,Set,require:p=>{
    if(p==='../lib/runtime')return{isTauriRuntime:()=>options.desktop!==false};
    if(p==='./auth')return{captureAccountSession:()=>options.signedOut?null:{accountId:'a',generation:1},isAccountSessionCurrent:()=>current};
    if(p==='./downloads-local')return{readDownloadSnapshot:async()=>{calls.push('sqlite');if(options.failure)throw Error('SQLite unavailable');if(options.switchAccount)current=false;return{jobs:options.jobs??[],resource_links:options.oldBuild?undefined:rows,snapshot_complete:options.complete??true};}};
    if(p==='./resources')return{getAllResources:async()=>{calls.push('http-resources');return [...rows];},getResources:async()=>{calls.push('http-folder');return [link('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')];}};
    if(p==='./mediaDownloads')return{getDownloadJobs:async()=>{calls.push('http-jobs');return options.jobs??[];},queueVideoDownload:()=>{throw Error('Reads must not create jobs');}};
    throw Error(p);
  }});return{api:exports,calls};
}
test('new and pre-existing saved links appear without enqueue, HTTP or a second persistence write',async()=>{
  const c=load({rows:[link(),link('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',{project_id:'project',parent_resource_id:'folder'})]});
  const result=await c.api.readDownloadIntake();assert.equal(result.resources.length,2);assert.deepEqual(c.calls,['sqlite']);
  assert.equal((await c.api.readDownloadIntake()).resources.length,2);
});
test('UUID normalization prevents duplicate rows and reconciles every job state',()=>{
  const c=load(),r=link();const compact=r.id.replaceAll('-','').toUpperCase();
  assert.equal(c.api.waitingDownloadLinks([r,{...r,id:compact}],[]).length,1);
  for(const status of ['queued','scheduled','downloading','paused','failed','cancelled','completed']){
    assert.equal(c.api.waitingDownloadLinks([r],[{resource_id:compact,status}]).length,0,status);
  }
  assert.equal(c.api.waitingDownloadLinks([r],[{resource_id:r.id,sync_state:'conflict'}]).length,0);
});
test('unsupported URLs, files and already downloaded resources do not become intake work',()=>{
  const {api}=load();
  for(const extra of [{url:'https://youtube.com.evil.test/v'},{url:'file://youtube.com/v'},{url:'broken'},{url:'https://example.com/manual.pdf'},{kind:'file'},{local_media_path:'server/video'},{local_media_filename:'video.mp4'},{local_media_downloaded_at:'2026-10-16'}])assert.equal(api.isDownloadableLink(link(undefined,extra)),false);
  for(const url of ['https://youtube.com/watch?v=123','https://youtu.be/123','https://m.facebook.com/reel/123','https://fb.watch/123','https://www.instagram.com/reel/123'])assert.equal(api.isDownloadableLink(link(undefined,{url})),true);
});
test('deleting a local resource removes it from intake; reading never recreates it',()=>{
  const {api}=load();assert.equal(api.waitingDownloadLinks([link()],[]).length,1);assert.equal(api.waitingDownloadLinks([],[]).length,0);
});
test('incomplete server snapshots still expose saved links with honest completeness',async()=>{
  const result=await load({complete:false}).api.readDownloadIntake();assert.equal(result.resources.length,1);assert.equal(result.complete,false);
});
test('local failure, old build and account switch fail closed without HTTP fallback',async()=>{
  for(const options of [{failure:true},{oldBuild:true},{switchAccount:true},{signedOut:true}]){
    const c=load(options);await assert.rejects(c.api.readDownloadIntake());assert.ok(c.calls.every(call=>call==='sqlite'));
  }
});
test('browser intake walks authorized folders and respects existing history',async()=>{
  const c=load({desktop:false,rows:[link(),{id:'folder',kind:'folder'}],jobs:[{resource_id:link().id,status:'cancelled'}]});
  const result=await c.api.readDownloadIntake();assert.equal(result.resources.length,1);assert.deepEqual(c.calls,['http-jobs','http-resources','http-folder']);
});
