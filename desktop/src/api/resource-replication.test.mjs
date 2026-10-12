import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load(options={}){
  const calls=[],events=[],exports={};let current=true,refreshed=0;
  const source=ts.transpileModule(readFileSync(new URL('./resource-replication.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,Event:class{constructor(type){this.type=type}},window:{dispatchEvent:e=>events.push(e.type)},require:p=>{
    if(p==='./auth')return {getToken:()=>options.offline?'local:lease':'token',captureServerRequest:async()=>({accountId:'account',nativeSessionToken:'session'}),isServerRequestCurrent:()=>current,observeNativeAuthFailure:async()=>{}};
    if(p==='../lib/runtime')return {isTauriRuntime:()=>!options.browser};
    if(p==='./resource-uploads')return {refreshLocalFileAccess:async()=>{refreshed++}};
    if(p==='./local-backend')return {localBackend:{invoke:async(command,args)=>{calls.push({command,args});if(options.switch)current=false;if(options.fail===args.resourceId)throw Error('Network unavailable');return{state:options.copying?'copying':'ready'};}}};
    throw Error('Unexpected dependency '+p);
  }});
  return {api:exports,calls,events,refreshed:()=>refreshed};
}
test('replicates files and completed link media, never external links or folders',async()=>{
  const t=load();await t.api.pullResourceFiles([{id:'file',kind:'file'},{id:'video',kind:'link',local_media_filename:'video.mp4'},{id:'url',kind:'link',url:'https://example.com'},{id:'folder',kind:'folder'}]);
  assert.deepEqual(t.calls.map(c=>c.args.resourceId),['file','video']);assert.ok(t.calls.every(c=>c.command==='replicate_local_resource'&&c.args.expectedAccountId==='account'&&c.args.expectedSessionToken==='session'));assert.equal(t.refreshed(),2);
});
test('one failed file does not block other copies or trigger another write path',async()=>{
  const t=load({fail:'bad'});await t.api.pullResourceFiles([{id:'bad',kind:'file'},{id:'good',kind:'file'}]);assert.equal(t.calls.length,2);assert.equal(t.refreshed(),1);
});
test('bounded rounds rotate pending copies fairly',async()=>{
  const t=load({copying:true});await t.api.pullResourceFiles([{id:'a',kind:'file'},{id:'b',kind:'file'}]);assert.equal(t.calls.length,16);assert.deepEqual(t.calls.slice(0,4).map(c=>c.args.resourceId),['a','b','a','b']);assert.equal(t.refreshed(),0);
});
test('offline tokens and browser runtime do not start replication',async()=>{
  for(const options of [{offline:true},{browser:true}]){const t=load(options);await t.api.pullResourceFiles([{id:'a',kind:'file'}]);assert.equal(t.calls.length,0);}
});
test('account switch prevents capability refresh and further file reads',async()=>{
  const t=load({switch:true});await t.api.pullResourceFiles([{id:'a',kind:'file'},{id:'b',kind:'file'}]);assert.equal(t.calls.length,1);assert.equal(t.refreshed(),0);assert.equal(t.events.length,0);
});
