import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const resource='11111111-1111-4111-8111-111111111111';
const compile=file=>ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const identityCode=compile('./download-enqueue-retry.ts'),apiCode=compile('./mediaDownloads.ts');
function load(options={},store=new Map()){
  const http=[],native=[],exports={},identity={};
  const storage={getItem:k=>store.get(k)??null,setItem:(k,v)=>{if(options.storageError)throw Error('STORAGE_FAILURE');store.set(k,v);},removeItem:k=>store.delete(k)};
  vm.runInNewContext(identityCode,{exports:identity,localStorage:storage,crypto:{randomUUID}});
  vm.runInNewContext(apiCode,{exports,require:p=>{
    if(p==='./download-enqueue-retry')return identity;
    if(p==='../lib/runtime')return{isTauriRuntime:()=>!!options.desktop};
    if(p==='./auth')return{captureAccountSession:()=>options.signedOut?null:{accountId:options.account??'a'},isAccountSessionCurrent:()=>!options.switched};
    if(p==='./downloads-local')return{enqueueLocalDownload:async(...args)=>{native.push(args);if(options.nativeError)throw Error('LOCAL_FAILURE');return{id:'local'};}};
    if(p==='./http')return{apiUrl:path=>(options.origin??'https://lab.test')+path,getApiErrorMessage:async()=> 'SERVER_FAILURE',apiFetch:async(path,init)=>{
      http.push({path,init});if(options.networkError)throw Error('NETWORK_FAILURE');
      return{ok:!options.status,status:options.status??201,json:async()=>{if(options.jsonError)throw Error('JSON_FAILURE');return options.badReceipt?{}:{id:init.headers['Idempotency-Key'],resource_id:resource};}};
    }};
    throw Error(p);
  }});return{api:exports,http,native,store};
}
test('uncertain browser request retains identity through module reload, then clears on accepted receipt',async()=>{
  const c=load({networkError:true});await assert.rejects(c.api.queueVideoDownload(resource),/NETWORK_FAILURE/);
  const key=c.http[0].init.headers['Idempotency-Key'];assert.equal(c.store.size,1);
  const reloaded=load({},c.store);const result=await reloaded.api.queueVideoDownload(resource.replaceAll('-','').toUpperCase());
  assert.equal(reloaded.http[0].init.headers['Idempotency-Key'],key);assert.equal(result.id,key);assert.equal(c.store.size,0);
});
test('HTTP errors, lost JSON and malformed replies keep the original identity',async()=>{
  for(const options of [{status:503},{status:408},{status:429},{status:403},{jsonError:true},{badReceipt:true}]){
    const c=load(options);await assert.rejects(c.api.queueVideoDownload(resource));assert.equal(c.store.size,1);
    await assert.rejects(c.api.queueVideoDownload(resource));assert.equal(c.http[0].init.headers['Idempotency-Key'],c.http[1].init.headers['Idempotency-Key']);
  }
});
test('different account, server or deliberate request gets a separate identity',async()=>{
  const store=new Map(),keys=[];
  for(const [options,quality] of [[{},'720p'],[{account:'b'},'720p'],[{origin:'https://other.test'},'720p'],[{},'480p']]){
    const c=load({...options,networkError:true},store);await assert.rejects(c.api.queueVideoDownload(resource,quality));keys.push(c.http[0].init.headers['Idempotency-Key']);
  }
  assert.equal(new Set(keys).size,4);
});
test('switching accounts rejects late success and preserves uncertain intent',async()=>{
  const c=load({switched:true});await assert.rejects(c.api.queueVideoDownload(resource),/Account changed/);assert.equal(c.store.size,1);
});
test('missing auth, broken storage or corrupt identity never sends a request',async()=>{
  const signedOut=load({signedOut:true});await assert.rejects(signedOut.api.queueVideoDownload(resource),/Sign in/);assert.equal(signedOut.http.length,0);
  const blocked=load({storageError:true});await assert.rejects(blocked.api.queueVideoDownload(resource),/STORAGE_FAILURE/);assert.equal(blocked.http.length,0);
  const first=load({networkError:true});await assert.rejects(first.api.queueVideoDownload(resource));first.store.set([...first.store.keys()][0],'corrupted');
  const corrupt=load({},first.store);await assert.rejects(corrupt.api.queueVideoDownload(resource),/identity is invalid/);assert.equal(corrupt.http.length,0);
});
test('desktop stays on native outbox including failures, with no browser journal',async()=>{
  const c=load({desktop:true,nativeError:true});await assert.rejects(c.api.queueVideoDownload(resource),/LOCAL_FAILURE/);assert.equal(c.native.length,1);assert.equal(c.http.length,0);assert.equal(c.store.size,0);
});
