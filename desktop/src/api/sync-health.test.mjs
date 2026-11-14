import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import test from 'node:test';import assert from 'node:assert/strict';
test('connectivity checks are bounded advisory requests without credentials',async()=>{
 let abort,cleared=false,args;const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./sync-health.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,AbortController,window:{setTimeout:(fn,ms)=>{assert.equal(ms,2000);abort=fn;return 1;},clearTimeout:()=>cleared=true},fetch:async(url,init)=>{args={url,init};return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('aborted'))));},require:()=>({API_BASE:'http://fixture/api'})});
 const run=exports.isSyncServerReachable();abort();assert.equal(await run,false);assert.equal(cleared,true);assert.equal(args.url,'http://fixture/api/health');assert.equal(args.init.credentials,'omit');assert.equal(args.init.headers,undefined);assert.equal(args.init.redirect,'error');
});


test('API throttling is reachable and never misreported as a lost connection',async()=>{
 for(const status of [200,429,503]){
  const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./sync-health.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,AbortController,window:{setTimeout:()=>1,clearTimeout(){}},fetch:async()=>({ok:status===200,status}),require:()=>({API_BASE:'http://fixture/api'})});
  assert.equal(await exports.isSyncServerReachable(),status!==503);
 }
});
