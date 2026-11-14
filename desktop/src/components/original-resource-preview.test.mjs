import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function harness(){
  let cursor=0,current=true;const slots=[],effects=[],listeners=new Map(),calls=[];
  const sourceExports={};
  const compile=name=>ts.transpileModule(readFileSync(new URL(name,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(compile('../lib/originalResourceSource.ts'),{exports:sourceExports,URL});
  const window={addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:k=>listeners.delete(k),open:()=>calls.push('browser')};
  const navigator={onLine:true};const exports={};
  vm.runInNewContext(compile('./OriginalResourcePreview.tsx'),{exports,window,navigator,require:name=>{
    if(name==='react')return{useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>slots[i]=v];},useEffect:(fn,deps)=>{const i=cursor++;const old=effects[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j]))){old?.cleanup?.();effects[i]={deps,cleanup:fn()};}}};
    if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
    if(name==='@tauri-apps/api/shell')return{open:async url=>calls.push(url)};
    if(name==='../api/auth')return{captureAccountSession:()=>({accountId:'A'}),isAccountSessionCurrent:()=>current};
    if(name==='../lib/originalResourceSource')return sourceExports;
    if(name==='../lib/runtime')return{isTauriRuntime:()=>true};
    if(name==='./FocusedResourceMedia')return{default:'local-media'};
    if(name==='../lib/audioFocus')return{default:{acquire:options=>{calls.push(options);return{id:options.id,generation:1};},isOwner:()=>true,release:()=>calls.push('release')}};
    throw Error(name);
  }});
  let props={resource:{id:'r',kind:'link',name:'Video',url:'https://youtu.be/M7lc1UVf-VE',local_media_filename:'video.mp4'},localUrl:'',aspect:'auto'};
  const render=updates=>{props={...props,...updates};cursor=0;return exports.default(props);};
  const flatten=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(flatten)];
  const find=(tree,type)=>flatten(tree).find(n=>n.type===type);
  const button=(tree,label)=>flatten(tree).find(n=>n.type==='button'&&n.props.children===label);
  return{render,find,button,calls,events:listeners,navigator,revoke:()=>{current=false;}};
}
test('online embed is explicit; completed copy does not interrupt it; local choice stops it',()=>{
  const h=harness();let tree=h.render();assert.equal(h.find(tree,'iframe'),undefined);
  h.button(tree,'Play original online').props.onClick();tree=h.render();assert.match(h.find(tree,'iframe').props.src,/youtube.com\/embed/);
  tree=h.render({localUrl:'labos-file://copy'});assert.ok(h.find(tree,'iframe'));
  h.button(tree,'Use local copy').props.onClick();tree=h.render();assert.equal(h.find(tree,'iframe'),undefined);assert.equal(h.find(tree,'local-media').props.src,'labos-file://copy');assert.ok(h.calls.includes('release'));
});
test('ready local copy is preferred without making any original-source request',()=>{
  const h=harness();const tree=h.render({localUrl:'labos-file://verified'});assert.ok(h.find(tree,'local-media'));assert.equal(h.find(tree,'iframe'),undefined);assert.equal(h.calls.length,0);
});
test('offline tears down embed and reconnect requires another explicit choice',()=>{
  const h=harness();h.button(h.render(),'Play original online').props.onClick();assert.ok(h.find(h.render(),'iframe'));
  h.navigator.onLine=false;h.events.get('offline')();assert.equal(h.find(h.render(),'iframe'),undefined);
  h.navigator.onLine=true;h.events.get('online')();assert.equal(h.find(h.render(),'iframe'),undefined);
});
test('expired authentication tears down embed and fences stale external-open handlers',async()=>{
  const h=harness();let tree=h.render();const stale=h.button(tree,'Open original site').props.onClick;
  h.button(tree,'Play original online').props.onClick();assert.ok(h.find(h.render(),'iframe'));
  h.revoke();h.events.get('labos:auth-expired')();assert.equal(h.find(h.render(),'iframe'),undefined);await stale();assert.equal(h.calls.some(c=>typeof c==='string'&&c.startsWith('https:')),false);
});
test('unsupported provider uses native external browser without an iframe',async()=>{
  const h=harness();const tree=h.render({resource:{id:'fb',kind:'link',url:'https://www.facebook.com/reel/123'}});assert.equal(h.find(tree,'iframe'),undefined);await h.button(tree,'Open original site').props.onClick();assert.deepEqual(h.calls,['https://www.facebook.com/reel/123']);
});
test('TTS/microphone preemption tears down the online player and releases focus',()=>{
  const h=harness();h.button(h.render(),'Play original online').props.onClick();h.render();h.calls.find(c=>typeof c==='object').onPreempt();assert.equal(h.find(h.render(),'iframe'),undefined);assert.ok(h.calls.includes('release'));
});
