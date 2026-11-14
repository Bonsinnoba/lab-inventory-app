import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
function client({switchAt}={},storage=new Map()){
 const exports={},calls=[],uploads=[];let current={accountId:'a',token:'browser-token',generation:1};
 const switchAccount=()=>{current={accountId:'b',token:'other-token',generation:2};};
 class XHR{
  constructor(){this.events={};this.headers={};this.progress={};this.upload={addEventListener:(name,fn)=>{this.progress[name]=fn;}};uploads.push(this);}
  addEventListener(name,fn){this.events[name]=fn;}open(method,url){calls.push({method,url});}setRequestHeader(key,value){this.headers[key]=value;}send(){};
 }
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./resources.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto:{randomUUID},sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},XMLHttpRequest:XHR,FormData:class{append(){}},URLSearchParams,navigator:{onLine:true},require:name=>{
  if(name==='../lib/runtime')return{isTauriRuntime:()=>false};
  if(name==='../lib/config')return{API_BASE:'https://lab.example/api'};
  if(name==='./auth')return{captureAccountSession:()=>current,isAccountSessionCurrent:owner=>owner===current,getToken:()=>current.token};
  if(name==='./http')return{apiFetch:async(path,options)=>{calls.push({path,options});if(switchAt==='response')switchAccount();return{ok:true,json:async()=>{if(switchAt==='body')switchAccount();return{id:'saved',kind:'folder'};}};},getApiErrorMessage:async()=> 'failed'};
  if(name==='@tauri-apps/api/tauri')return{invoke:async()=>{throw Error('Unexpected native write');}};
  return{};
 }});
 return{api:exports,calls,uploads,switchAccount,storage};
}
for(const method of ['createFolder','createLink'])test(`${method} rejects late browser confirmations after account change`,async()=>{
 for(const switchAt of ['response','body']){
  const c=client({switchAt}),args=method==='createFolder'?['Folder',{}]:['https://example.test',{}];
  await assert.rejects(c.api[method](...args),/Account changed/);
 }
});
test('browser folder manifest discards both late response and late body after account change',async()=>{
 for(const switchAt of ['response','body']){const c=client({switchAt});await assert.rejects(c.api.getResourceManifest('folder'),/Account changed/);}
});

for(const [method,args] of [['getAllResources',[]],['getResources',[{parent_resource_id:'folder'}]],['getResource',['file']]])test(`${method} discards browser metadata from a changed account`,async()=>{
 for(const switchAt of ['response','body']){const c=client({switchAt});await assert.rejects(c.api[method](...args),/Account changed/);}
});

test('browser all-resources explicitly requests authorized descendants',async()=>{
 const c=client();await c.api.getAllResources();assert.equal(c.calls[0].path,'/resources?include_descendants=true');
});
for(const folder of [false,true])test(`${folder?'folder':'file'} upload keeps its original bearer and rejects a foreign-session result`,async()=>{
 const c=client(),file={name:'file.txt',size:3,type:'text/plain'};
 const progress=[];const report=value=>progress.push(value);
 const promise=folder?c.api.uploadFolderFiles('folder',[file],['file.txt'],report):c.api.uploadFile(file,{},undefined,report);
 const rejected=assert.rejects(promise,/Account changed/),xhr=c.uploads[0];
 assert.equal(xhr.headers.Authorization,'Bearer browser-token');
 xhr.progress.progress({lengthComputable:true,loaded:1,total:2});assert.deepEqual(progress,[50]);
 c.switchAccount();xhr.progress.progress({lengthComputable:true,loaded:2,total:2});assert.deepEqual(progress,[50]);xhr.status=201;xhr.responseText=JSON.stringify(folder?[{id:'saved'}]:{id:'saved'});await xhr.events.load();await rejected;
});
for(const folder of [false,true])test(`${folder?'folder':'file'} upload retry survives module reload and clears only after a complete same-account confirmation`,async()=>{
 const storage=new Map(),file={name:'file.txt',size:3,type:'text/plain',lastModified:10};
 const start=c=>folder?c.api.uploadFolderFiles('folder',[file],['file.txt']):c.api.uploadFile(file,{});
 const first=client({},storage),pending=start(first),failed=assert.rejects(pending,/confirmation unavailable/);
 const original=first.uploads[0].headers['Idempotency-Key'];assert.ok(original);first.uploads[0].events.error();await failed;
 const next=client({},storage),retry=start(next),xhr=next.uploads[0];assert.equal(xhr.headers['Idempotency-Key'],original);
 xhr.status=201;xhr.responseText=JSON.stringify(folder?[{id:'saved',kind:'file'}]:{id:'saved',kind:'file'});await xhr.events.load();await retry;
 const again=start(next),fresh=next.uploads[1];assert.notEqual(fresh.headers['Idempotency-Key'],original);
 const cancelled=assert.rejects(again,/cancelled/);fresh.events.abort();await cancelled;
});
test('malformed upload confirmation retains identity and foreign accounts cannot reuse it',async()=>{
 const storage=new Map(),file={name:'file.txt',size:3,type:'text/plain'};
 const first=client({},storage),pending=first.api.uploadFile(file,{}),rejected=assert.rejects(pending,/Incomplete upload/),xhr=first.uploads[0];xhr.status=201;xhr.responseText='{}';await xhr.events.load();await rejected;
 const key=xhr.headers['Idempotency-Key'];first.switchAccount();const next=first.api.uploadFile(file,{}),cancelled=assert.rejects(next,/cancelled/);assert.notEqual(first.uploads[1].headers['Idempotency-Key'],key);first.uploads[1].events.abort();await cancelled;
});
