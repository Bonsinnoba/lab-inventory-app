import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function preview({desktop=true,poster,resource,failed=false}={}){
  const exports={},calls=[];
  const code=ts.transpileModule(readFileSync(new URL('./DownloadResourcePreview.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,require:p=>{
    if(p==='react')return{useEffect:()=>{},useState:()=>[failed,()=>{}]};
    if(p==='react/jsx-runtime')return{jsx:(type,props)=>({type,props})};
    if(p==='lucide-react')return{Film:'film-placeholder'};
    if(p==='../lib/runtime')return{isTauriRuntime:()=>desktop};
    if(p==='./VideoResourcePoster')return{useVideoPoster:r=>{calls.push(r);return poster;}};
    if(p==='../api/mediaDownloads')return{getLocalThumbnailUrl:()=>{calls.push('server-url');return 'https://server/thumbnail';}};
    throw Error(p);
  }});
  return{render:thumbnail_url=>exports.default({job:{resource_id:'r',thumbnail_url},resource}),calls};
}

test('desktop missing preview never falls back to HTTP or external URLs',()=>{
  for(const url of ['/api/media-downloads/r/thumbnail','https://external/image.jpg']){
    const p=preview();assert.equal(p.render(url).props.children.type,'film-placeholder');assert.deepEqual(p.calls,[null]);
  }
});
test('desktop uses the authorized local resource poster independently of server job artwork',()=>{
  const resource={id:'r'},p=preview({resource,poster:'blob:local'});
  assert.equal(p.render(undefined).props.children.props.src,'blob:local');assert.deepEqual(p.calls,[resource]);
});
test('failed preview shows placeholder, never retries against server',()=>{
  const p=preview({poster:'blob:bad',failed:true});assert.equal(p.render('/api/image').props.children.type,'film-placeholder');assert.deepEqual(p.calls,[null]);
});
test('browser retains its server thumbnail route',()=>{
  const p=preview({desktop:false});assert.equal(p.render('/api/image').props.children.props.src,'https://server/thumbnail');assert.deepEqual(p.calls,[null,'server-url']);
});
