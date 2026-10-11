import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load(options={}){
  let current=true;const calls=[],http=[],exports={};
  const source=ts.transpileModule(readFileSync(new URL('./resource-posters.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,Blob,Uint8Array,require:name=>{
    if(name==='./auth')return{captureAccountSession:()=>options.out?null:{accountId:'a'},isAccountSessionCurrent:()=>current,getToken:()=> 'test-token'};
    if(name==='./local-backend')return{localBackend:{invoke:async(command,args)=>{calls.push({command,args});if(options.fail)throw Error('local failed');if(options.switched)current=false;return options.bytes??null;}}};
    if(name==='./http')return{apiFetch:async()=>{http.push(true);throw Error('unexpected HTTP');},apiUrl:p=>'http://localhost/api'+p};
    if(name==='../lib/runtime')return{isTauriRuntime:()=>true};
    throw Error(name);
  }});return{api:exports,calls,http};
}
const resource={id:'a',file_type:'video',updated_at:'2026-10-11T00:00:00Z',thumbnail_url:'https://outside.invalid/track'};
test('poster read is local-only and missing/failing cache never falls back to network',async()=>{
  const missing=load();assert.equal(await missing.api.readResourcePoster(resource),null);assert.equal(missing.http.length,0);
  const failed=load({fail:true});await assert.rejects(failed.api.readResourcePoster(resource),/local failed/);assert.equal(failed.http.length,0);
  assert.equal(missing.calls[0].args.revision,resource.updated_at);
});
test('poster read rejects switched account; URL builder never sends token to a resource-provided URL',async()=>{
  const changed=load({switched:true,bytes:[255,216,255,217]});await assert.rejects(changed.api.readResourcePoster(resource),/Account changed/);
  const out=load({out:true});assert.equal(await out.api.readResourcePoster(resource),null);assert.equal(out.calls.length,0);
  assert.equal(new URL(changed.api.serverPosterUrl(resource)).hostname,'localhost');
});
