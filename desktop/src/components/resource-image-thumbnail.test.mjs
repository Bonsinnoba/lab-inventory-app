import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function render({desktop=true,local=null,failedUrl=null}={}){
  const calls=[],exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./ResourceImageThumbnail.tsx',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
  }).outputText,{exports,require:name=>{
    if(name==='react')return{useState:()=>[failedUrl,()=>{}]};
    if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props})};
    if(name==='../api/resources')return{getResourceDownloadUrl:()=>{calls.push('http');return'https://server/image';}};
    if(name==='../api/resource-uploads')return{localFileUrl:()=>{calls.push('native-grant');return local;}};
    if(name==='../lib/runtime')return{isTauriRuntime:()=>desktop};
    throw Error(name);
  }});
  return{tree:exports.default({resource:{id:'image',name:'Image',thumbnail_url:'https://external/tracker'}}),calls};
}
test('missing native image grant shows availability message, never server or external URL',()=>{
  const r=render();assert.equal(r.tree.type,'div');assert.match(r.tree.props.children,/not available on this PC/);
  assert.deepEqual(r.calls,['native-grant']);
});
test('desktop uses current native file URL and failed image never falls back to HTTP',()=>{
  const r=render({local:'https://labos-file.localhost/grant'});
  assert.equal(r.tree.type,'img');assert.equal(r.tree.props.src,'https://labos-file.localhost/grant');
  const failed=render({local:'local:grant',failedUrl:'local:grant'});
  assert.equal(failed.tree.type,'div');assert.deepEqual(failed.calls,['native-grant']);
});
test('replacement native grant can render after the preceding grant failed',()=>{
  const r=render({local:'local:new',failedUrl:'local:old'});assert.equal(r.tree.props.src,'local:new');
});
test('browser retains server image access without calling native grants',()=>{
  const r=render({desktop:false});assert.equal(r.tree.props.src,'https://server/image');assert.deepEqual(r.calls,['http']);
});
