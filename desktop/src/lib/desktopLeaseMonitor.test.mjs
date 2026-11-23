import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

function fixture(token='jwt'){
 let session={accountId:'a',token,generation:1},calls=0,expired=0;
 const replies=[];
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./desktopLeaseMonitor.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({
  captureAccountSession:()=>session,
  isAccountSessionCurrent:captured=>!!session&&captured.accountId===session.accountId&&captured.token===session.token&&captured.generation===session.generation,
  getLocalAuthStatus:()=>{calls++;return new Promise((resolve,reject)=>replies.push({resolve,reject}));},
 })});
 const monitor=exports.createDesktopLeaseMonitor(()=>expired++);
 return{monitor,replies,get calls(){return calls},get expired(){return expired},switchSession:next=>{session=next}};
}
const valid=token=>({authenticated:true,user:{id:'a'},token});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

test('expired native lease locks both JWT and local-token workspaces exactly once',async()=>{
 for(const token of ['server-jwt','local:lease']){
  const f=fixture(token);const p=f.monitor.check();
  for(let i=0;i<20;i++)void f.monitor.check();
  f.replies[0].resolve({authenticated:false,user:null});await p;await tick();
  assert.equal(f.expired,1);assert.equal(f.calls,1);
  await f.monitor.check();assert.equal(f.expired,1);assert.equal(f.calls,1);
 }
});

test('valid native authority preserves JWT without demanding a local renderer token',async()=>{
 const f=fixture('server-jwt');const p=f.monitor.check();f.replies[0].resolve(valid('local:native-lease'));await p;
 assert.equal(f.expired,0);
});

test('burst checks coalesce and schedule at most one follow-up after a slow read',async()=>{
 const f=fixture();const p=f.monitor.check();for(let i=0;i<100;i++)void f.monitor.check();
 assert.equal(f.calls,1);f.replies[0].resolve(valid('local:x'));await p;await tick();
 assert.equal(f.calls,2);f.replies[1].resolve(valid('local:x'));await tick();
 assert.equal(f.calls,2);assert.equal(f.expired,0);
});

test('stale failure cannot lock a switched account or same-account re-entry',async()=>{
 for(const next of [{accountId:'b',token:'new',generation:2},{accountId:'a',token:'jwt',generation:2},null]){
  const f=fixture();const p=f.monitor.check();f.switchSession(next);
  f.replies[0].resolve({authenticated:false,user:null});await p;
  assert.equal(f.expired,0);
 }
});

test('pending resume rechecks the new session after discarding an old response',async()=>{
 const f=fixture();const p=f.monitor.check();
 f.switchSession({accountId:'b',token:'new',generation:2});void f.monitor.check();
 f.replies[0].resolve({authenticated:false,user:null});await p;await tick();
 assert.equal(f.calls,2);assert.equal(f.expired,0);
 f.replies[1].resolve({authenticated:true,user:{id:'b'},token:'local:b'});await tick();assert.equal(f.expired,0);
});

test('native account or local-session mismatch locks rather than adopting another login',async()=>{
 for(const status of [{authenticated:true,user:{id:'b'},token:'local:lease'},valid('local:other')]){
  const f=fixture('local:lease');const p=f.monitor.check();f.replies[0].resolve(status);await p;assert.equal(f.expired,1);
 }
});

test('storage/IPC failure or absent bridge is not treated as revoked authority',async()=>{
 const f=fixture();let p=f.monitor.check();f.replies[0].reject(Error('storage busy'));await p;
 assert.equal(f.expired,0);p=f.monitor.check();f.replies[1].resolve(null);await p;assert.equal(f.expired,0);
 p=f.monitor.check();f.replies[2].resolve(valid('local:x'));await p;assert.equal(f.expired,0);
});

test('disposal suppresses late callbacks and queued native invokes',async()=>{
 const f=fixture();const p=f.monitor.check();void f.monitor.check();f.monitor.stop();
 f.replies[0].resolve({authenticated:false,user:null});await p;await tick();
 await f.monitor.check();assert.equal(f.calls,1);assert.equal(f.expired,0);
});

test('signed-out monitor performs no native read',async()=>{
 const f=fixture();f.switchSession(null);await f.monitor.check();assert.equal(f.calls,0);assert.equal(f.expired,0);
});
