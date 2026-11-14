import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';
import test from 'node:test';import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./automatic-sync.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(extra={}){let session={accountId:'a',token:'a',generation:1};const forces=[],events=[];const automatic=exports.createAutomaticSync({session:()=>session,isCurrent:s=>s===session,reachable:async()=>true,sync:async force=>{forces.push(force);return true;},unavailable:()=>events.push('offline'),completed:()=>events.push('complete'),...extra});return{automatic,forces,events,change(){session={accountId:'b',token:'b',generation:2};}};}
test('slow automatic sync has one owner and one completion despite repeated timer ticks',async()=>{
 const wait=deferred();let calls=0;const f=fixture({sync:async()=>{calls++;await wait.promise;return true;}});
 const run=f.automatic.tick();await Promise.resolve();await Promise.resolve();
 for(let i=0;i<100;i++)assert.equal(f.automatic.tick(),run);
 wait.resolve();await run;assert.equal(calls,1);assert.deepEqual(f.events,['complete']);
});
test('server restoration bypasses prior backoff once without requiring a browser online event',async()=>{
 let available=false;const f=fixture({reachable:async()=>available});
 await f.automatic.tick();assert.deepEqual(f.events,['offline']);assert.equal(f.forces.length,0);
 available=true;await f.automatic.tick();await f.automatic.tick();assert.deepEqual(f.forces,[true,false]);
});
test('skipped backoff work does not invalidate queries and old-account results are fenced',async()=>{
 const skipped=fixture({sync:async()=>false});await skipped.automatic.tick();assert.equal(skipped.events.length,0);
 const wait=deferred();const f=fixture({reachable:()=>wait.promise});const run=f.automatic.tick();f.change();wait.resolve(true);await run;assert.equal(f.forces.length,0);assert.equal(f.events.length,0);
});
test('stopping a scheduler suppresses late callbacks and explicit recoveries coalesce',async()=>{
 const wait=deferred();const f=fixture({reachable:()=>wait.promise});const run=f.automatic.tick();f.automatic.tick(true);f.automatic.stop();wait.resolve(true);await run;assert.equal(f.forces.length,0);assert.equal(f.events.length,0);
});
test('a failed attempt releases the scheduler for the next tick',async()=>{
 let fail=true;const f=fixture({sync:async()=>{if(fail)throw Error('network');return true;}});
 await f.automatic.tick();fail=false;await f.automatic.tick();assert.deepEqual(f.events,['complete']);
});
