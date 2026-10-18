import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import {QueryClient} from '@tanstack/react-query';

// Small hook lifecycle harness: tests effects, cleanup and async races without
// asserting that a mocked render proves visual acceptance in the native app.
function hooks(){
  const slots=[];let cursor=0,effects=[];
  const react={
    useState(initial){const i=cursor++;slots[i]??={value:initial};return[slots[i].value,value=>{slots[i].value=value;}];},
    useRef(initial){const i=cursor++;slots[i]??={current:initial};return slots[i];},
    useCallback(fn){cursor++;return fn;},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j]))){effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:fn()};});}},
  };
  return {react,render(fn){cursor=0;const result=fn();const pending=effects;effects=[];pending.forEach(f=>f());return result;},unmount(){slots.forEach(s=>s?.cleanup?.());}};
}
function compile(file,require,extra={}){
  const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
  }).outputText,{exports,require,Uint8Array,...extra});return exports;
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const resource={id:'video',updated_at:'revision-1',file_type:'video'};
function poster(){
  const lifecycle=hooks(),events=new Map(),created=[],revoked=[];
  let account={accountId:'a',generation:1},read=async()=>new Blob([new Uint8Array([1,2,3])]);
  const api=compile('./VideoResourcePoster.tsx',name=>{
    if(name==='react')return lifecycle.react;
    if(name==='react/jsx-runtime')return{};
    if(name==='lucide-react')return{};
    if(name==='../api/resource-posters')return{readResourcePoster:()=>read(),serverPosterUrl:()=>'/server'};
    if(name==='../api/auth')return{captureAccountSession:()=>account,isAccountSessionCurrent:s=>s===account};
    if(name==='../lib/runtime')return{isTauriRuntime:()=>true};
    throw Error(name);
  },{window:{addEventListener:(name,fn)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener:(name,fn)=>events.get(name)?.delete(fn)},
    URL:{createObjectURL:()=>{const url=`blob:${created.length}`;created.push(url);return url;},revokeObjectURL:url=>revoked.push(url)}});
  return {created,revoked,render:(r=resource)=>lifecycle.render(()=>api.useVideoPoster(r)),emit:name=>events.get(name)?.forEach(f=>f()),read:fn=>{read=fn;},switch:()=>{account={accountId:'b',generation:2};},unmount:()=>lifecycle.unmount()};
}

test('identical poster bytes preserve the displayed URL across sync and profile refreshes',async()=>{
  const p=poster();p.render();await settle();const original=p.render();assert.equal(original,'blob:0');
  p.emit('labos-posters-updated');await settle();assert.equal(p.render(),original);
  p.emit('labos-user-updated');assert.equal(p.render(),original);await settle();
  assert.equal(p.render(),original);assert.equal(p.created.length,1);assert.equal(p.revoked.length,0);
  p.unmount();assert.deepEqual(p.revoked,['blob:0']);
});
test('changed poster bytes replace only that preview and missing/denied reads clear it',async()=>{
  const p=poster();p.render();await settle();p.render();
  p.read(async()=>new Blob([new Uint8Array([4,5])]));p.emit('labos-posters-updated');await settle();
  assert.equal(p.render(),'blob:1');assert.deepEqual(p.revoked,['blob:0']);
  p.read(async()=>null);p.emit('labos-posters-updated');await settle();assert.equal(p.render(),undefined);
  p.read(async()=>new Blob(['new']));p.emit('labos-posters-updated');await settle();assert.ok(p.render());
  p.read(async()=>{throw Error('permission denied');});p.emit('labos-posters-updated');await settle();assert.equal(p.render(),undefined);
});
test('resource revision/account changes hide the old image before effects finish',async()=>{
  const p=poster();p.render();await settle();assert.ok(p.render());
  p.read(()=>new Promise(()=>{}));assert.equal(p.render({...resource,updated_at:'revision-2'}),undefined);
  const q=poster();q.render();await settle();assert.ok(q.render());q.switch();assert.equal(q.render(),undefined);
  await settle();q.emit('labos:auth-expired');assert.equal(q.render(),undefined);
});
test('late preview reads cannot overwrite newer results or revive an expired image',async()=>{
  const p=poster();p.render();await settle();p.render();let finish;
  p.read(()=>new Promise(resolve=>{finish=resolve;}));p.emit('labos-posters-updated');
  p.read(async()=>new Blob(['newer']));p.emit('labos-posters-updated');await settle();const newest=p.render();
  finish(new Blob(['older']));await settle();assert.equal(p.render(),newest);
  p.read(()=>new Promise(resolve=>{finish=resolve;}));p.emit('labos-posters-updated');p.emit('labos:auth-expired');
  finish(new Blob(['late']));await settle();assert.equal(p.render(),undefined);
});
test('manual refresh tracks an explicit action, ignores double-clicks and resets after errors',async()=>{
  const h=hooks(),api=compile('../hooks/useManualRefresh.ts',name=>{assert.equal(name,'react');return h.react;});
  const render=()=>h.render(()=>api.useManualRefresh());let finish,calls=0;assert.equal(render().refreshing,false);
  const pending=render().refresh(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});assert.equal(render().refreshing,true);
  await render().refresh(()=>calls++);assert.equal(calls,1);finish();await pending;assert.equal(render().refreshing,false);
  await assert.rejects(render().refresh(async()=>{throw Error('failed');}),/failed/);assert.equal(render().refreshing,false);
  h.unmount();
});
test('query structural sharing retains unchanged rows while applying actual edits and deletes',async()=>{
  const client=new QueryClient();const key=['silent-refresh'];
  client.setQueryData(key,[{id:'a',name:'same'},{id:'b',name:'before'}]);const before=client.getQueryData(key);
  await client.fetchQuery({queryKey:key,queryFn:async()=>[{id:'a',name:'same'},{id:'b',name:'before'}]});
  assert.equal(client.getQueryData(key),before);
  await client.fetchQuery({queryKey:key,queryFn:async()=>[{id:'a',name:'same'},{id:'b',name:'after'}]});
  const changed=client.getQueryData(key);assert.equal(changed[0],before[0]);assert.notEqual(changed[1],before[1]);
  await client.fetchQuery({queryKey:key,queryFn:async()=>[{id:'b',name:'after'}]});assert.equal(client.getQueryData(key).length,1);client.clear();
});
