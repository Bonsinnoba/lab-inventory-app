import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load(options={}){
  const calls=[],events=[],exports={},timers=new Map(),listeners=new Map();let current=true,refreshed=0,now=0,sequence=0,statusReads=0;
  const source=ts.transpileModule(readFileSync(new URL('./resource-replication.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(source,{exports,Date:{now:()=>now},navigator:{get onLine(){return options.connected!==false}},Event:class{constructor(type){this.type=type}},window:{dispatchEvent:e=>events.push(e.type),setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,at:now+ms});return id},clearTimeout:id=>timers.delete(id),addEventListener:(name,fn)=>listeners.set(name,fn)},require:p=>{
    if(p==='./auth')return {getToken:()=>options.offline?'local:lease':'token',captureServerRequest:async()=>{await options.capture?.();return{accountId:options.account||'account',nativeSessionToken:options.session||'session',token:'token'}},isServerRequestCurrent:context=>current&&context.accountId===(options.account||'account')&&context.nativeSessionToken===(options.session||'session'),observeNativeAuthFailure:async()=>{}};
    if(p==='../lib/runtime')return {isTauriRuntime:()=>!options.browser};
    if(p==='./resource-uploads')return {refreshLocalFileAccess:async()=>{refreshed++}};
    if(p==='./local-backend')return {localBackend:{invoke:async(command,args)=>{if(command==='local_resource_copy_status'){statusReads++;await options.statusRead?.();if(options.statusFailure)throw Error('Copy status unavailable');return structuredClone(options.statuses||{});}calls.push({command,args});await options.replicate?.(args);if(options.switch)current=false;if(options.fail===args.resourceId)throw Error(options.failureMessage||'File unavailable');return{state:options.copying?'copying':'ready'};}}};
    throw Error('Unexpected dependency '+p);
  }});
  return {api:exports,calls,events,refreshed:()=>refreshed,statusReads:()=>statusReads,timers,
    invalidate:()=>{current=false;listeners.get('labos:auth-expired')?.()},
    next:async()=>{const entry=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];assert.ok(entry,'expected a scheduled batch');timers.delete(entry[0]);now=entry[1].at;await entry[1].fn();},
    nextDelay:()=>Math.min(...[...timers.values()].map(t=>t.at-now)),
  };
}
test('replicates files and completed link media, never external links or folders',async()=>{
  const t=load();await t.api.pullResourceFiles([{id:'file',kind:'file'},{id:'video',kind:'link',local_media_filename:'video.mp4'},{id:'url',kind:'link',url:'https://example.com'},{id:'folder',kind:'folder'}]);
  assert.deepEqual(t.calls.map(c=>c.args.resourceId),['file','video']);assert.ok(t.calls.every(c=>c.command==='replicate_local_resource'&&c.args.expectedAccountId==='account'&&c.args.expectedSessionToken==='session'));assert.equal(t.refreshed(),1);assert.equal(t.events.length,1);
});
test('one failed file does not block other copies or trigger another write path',async()=>{
  const t=load({fail:'bad'});await t.api.pullResourceFiles([{id:'bad',kind:'file'},{id:'good',kind:'file'}]);assert.equal(t.calls.length,2);assert.equal(t.refreshed(),1);
});
test('bounded batches rotate all incomplete files fairly across cycles',async()=>{
  const t=load({copying:true}),rows=Array.from({length:10},(_,i)=>({id:String(i),kind:'file'}));
  await t.api.pullResourceFiles(rows);assert.equal(t.calls.length,4);
  await t.api.pullResourceFiles(rows);assert.equal(t.calls.length,4,'metadata refresh must not bypass pacing');await t.next();await t.next();
  assert.deepEqual(t.calls.map(c=>c.args.resourceId),['0','1','2','3','4','5','6','7','8','9','0','1']);assert.equal(t.refreshed(),0);
});
test('locally verified ready copies do not trigger network verification on each sync',async()=>{
  const t=load({statuses:{ready:{state:'ready'},stale:{state:'stale'}}});
  await t.api.pullResourceFiles([{id:'ready',kind:'file'},{id:'stale',kind:'file'}]);
  assert.deepEqual(t.calls.map(c=>c.args.resourceId),['stale']);assert.equal(t.refreshed(),1);
});
test('offline tokens and browser runtime do not start replication',async()=>{
  for(const options of [{offline:true},{browser:true}]){const t=load(options);await t.api.pullResourceFiles([{id:'a',kind:'file'}]);assert.equal(t.calls.length,0);}
});
test('account switch prevents capability refresh and further file reads',async()=>{
  const t=load({switch:true});await t.api.pullResourceFiles([{id:'a',kind:'file'},{id:'b',kind:'file'}]);assert.equal(t.calls.length,1);assert.equal(t.refreshed(),0);assert.equal(t.events.length,0);
});

test('native throttling stops the batch without publishing a completed copy',async()=>{
 const t=load({fail:'a',failureMessage:'AUTH_THROTTLED: Wait before retrying'});
 await t.api.pullResourceFiles([{id:'a',kind:'file'},{id:'b',kind:'file'}]);
 assert.equal(t.calls.length,1);assert.equal(t.refreshed(),0);assert.equal(t.events.length,0);
});

test('one intake drains 2,000 files without waiting for another metadata cycle',async()=>{
 const t=load(),rows=Array.from({length:2000},(_,i)=>({id:String(i).padStart(4,'0'),kind:'file'}));
 await t.api.pullResourceFiles(rows);assert.equal(t.calls.length,4);assert.equal(t.nextDelay(),6000);
 let batches=1;while(t.timers.size){await t.next();batches++;assert.ok(batches<=501,'queue must become idle');}
 assert.equal(t.calls.length,2000);assert.equal(new Set(t.calls.map(c=>c.args.resourceId)).size,2000);
 assert.equal(t.statusReads(),1);assert.ok(t.refreshed()<=500,'capability scans and publication must be coalesced by batch, not per file');
 assert.ok(t.events.length>0);assert.equal(t.events.length,t.refreshed());
 assert.ok(t.events.every(type=>type==='labos:resource-copies-updated'),'copy progress must not invalidate every application query');
});

test('partial copies rotate fairly and continue on their own after yielding',async()=>{
 const t=load({copying:true}),rows=Array.from({length:10},(_,i)=>({id:String(i),kind:'file'}));
 await t.api.pullResourceFiles(rows);await t.next();await t.next();
 assert.deepEqual(t.calls.map(c=>c.args.resourceId),['0','1','2','3','4','5','6','7','8','9','0','1']);
 assert.equal(t.statusReads(),1);assert.equal(t.events.length,0);assert.equal(t.nextDelay(),6000);
});

test('throttle backoff survives fresh metadata and retries automatically with a growing bounded delay',async()=>{
 const options={fail:'a',failureMessage:'AUTH_THROTTLED: Wait before retrying'},t=load(options),rows=[{id:'a',kind:'file'}];
 await t.api.pullResourceFiles(rows);assert.equal(t.nextDelay(),30000);
 await t.api.pullResourceFiles(rows);assert.equal(t.calls.length,1);assert.equal(t.nextDelay(),30000);
 await t.next();assert.equal(t.calls.length,2);assert.equal(t.nextDelay(),60000);
 for(let i=0;i<5;i++)await t.next();assert.equal(t.nextDelay(),300000);
 options.fail=null;await t.api.pullResourceFiles([...rows,{id:'b',kind:'file'}]);await t.next();while(t.timers.size)await t.next();
 assert.ok(t.calls.some(c=>c.args.resourceId==='b'));assert.ok(t.events.length>0);
});

test('one persistently bad file backs off while all other files finish',async()=>{
 const t=load({fail:'bad'}),rows=[{id:'bad',kind:'file'},...Array.from({length:10},(_,i)=>({id:'good'+i,kind:'file'}))];
 await t.api.pullResourceFiles(rows);await t.next();await t.next();
 assert.equal(t.calls.filter(c=>c.args.resourceId==='bad').length,1);
 assert.equal(new Set(t.calls.filter(c=>c.args.resourceId!=='bad').map(c=>c.args.resourceId)).size,10);
 assert.ok(t.nextDelay()>250);await t.next();assert.equal(t.calls.filter(c=>c.args.resourceId==='bad').length,2);
 assert.equal(t.nextDelay(),60000);
});

test('logout cancels a scheduled batch and never publishes another capability',async()=>{
 const t=load();await t.api.pullResourceFiles(Array.from({length:8},(_,i)=>({id:String(i),kind:'file'})));
 assert.equal(t.calls.length,4);const published=t.refreshed();t.invalidate();
 assert.equal(t.timers.size,0);assert.equal(t.calls.length,4);assert.equal(t.refreshed(),published);
});

test('a replacement snapshot received during transfer is not dropped or published as the old file',async()=>{
 let release;const blocked=new Promise(resolve=>release=resolve);let first=true;
 const t=load({replicate:async()=>{if(first){first=false;await blocked}}});
 const active=t.api.pullResourceFiles([{id:'old',kind:'file'}]);
 while(!t.calls.length)await Promise.resolve();
 await t.api.pullResourceFiles([{id:'new',kind:'file'}]);release();await active;
 assert.equal(t.refreshed(),0);await t.next();
 assert.deepEqual(t.calls.map(c=>c.args.resourceId),['old','new']);assert.equal(t.timers.size,0);assert.equal(t.refreshed(),1);
});

test('removing the last file during transfer does not retain a stale scheduled copy',async()=>{
 let release;const blocked=new Promise(resolve=>release=resolve);
 const t=load({replicate:async()=>blocked}),active=t.api.pullResourceFiles([{id:'old',kind:'file'}]);
 while(!t.calls.length)await Promise.resolve();await t.api.pullResourceFiles([]);release();await active;
 await t.next();assert.equal(t.calls.length,1);assert.equal(t.timers.size,0);assert.equal(t.refreshed(),0);
});

test('account replacement during transfer runs only the new intake with the new native session',async()=>{
 let release;const blocked=new Promise(resolve=>release=resolve);let first=true;
 const options={replicate:async()=>{if(first){first=false;await blocked}}},t=load(options);
 const active=t.api.pullResourceFiles([{id:'old1',kind:'file'},{id:'old2',kind:'file'}]);
 while(!t.calls.length)await Promise.resolve();options.account='new-account';options.session='new-session';
 await t.api.pullResourceFiles([{id:'new',kind:'file'}]);release();await active;await t.next();
 assert.deepEqual(t.calls.map(c=>c.args.resourceId),['old1','new']);
 assert.equal(t.calls[1].args.expectedAccountId,'new-account');assert.equal(t.calls[1].args.expectedSessionToken,'new-session');
 assert.equal(t.refreshed(),1);assert.equal(t.timers.size,0);
});

test('status failure schedules retry rather than treating missing proof as ready',async()=>{
 const options={statusFailure:true},t=load(options);
 await assert.rejects(t.api.pullResourceFiles([{id:'a',kind:'file'}]),/Copy status unavailable/);
 assert.equal(t.calls.length,0);assert.equal(t.events.length,0);assert.equal(t.nextDelay(),30000);
 options.statusFailure=false;await t.next();assert.equal(t.calls.length,1);assert.equal(t.timers.size,0);
});

test('network offline pauses native transfers and resumes from the existing intake',async()=>{
 const options={connected:false},t=load(options);await t.api.pullResourceFiles([{id:'a',kind:'file'}]);
 assert.equal(t.calls.length,0);assert.equal(t.statusReads(),0);assert.equal(t.nextDelay(),30000);
 options.connected=true;await t.next();assert.equal(t.calls.length,1);assert.equal(t.timers.size,0);
});

test('quota exhaustion pauses the entire queue without dropping its intake',async()=>{
 const options={fail:'a',failureMessage:'Device copy quota exceeded'},t=load(options),rows=[{id:'a',kind:'file'},{id:'b',kind:'file'}];
 await t.api.pullResourceFiles(rows);assert.equal(t.calls.length,1);assert.equal(t.nextDelay(),300000);
 await t.api.pullResourceFiles(rows);assert.equal(t.calls.length,1);assert.equal(t.nextDelay(),300000);
 options.fail=null;await t.next();while(t.timers.size)await t.next();assert.equal(new Set(t.calls.map(c=>c.args.resourceId)).size,2);
});

test('an entirely denied batch pauses rather than sweeping thousands of failures in a tight loop',async()=>{
 const t=load({replicate:async()=>{throw Error('Resource authority unavailable')}});
 await t.api.pullResourceFiles(Array.from({length:2000},(_,i)=>({id:String(i),kind:'file'})));
 assert.equal(t.calls.length,4);assert.equal(t.nextDelay(),30000);
 await t.next();assert.equal(t.calls.length,8);assert.equal(t.nextDelay(),30000);
});

test('late intake capture cannot replace a newer authorized snapshot',async()=>{
 let release;const blocked=new Promise(resolve=>release=resolve);let first=true;
 const t=load({capture:async()=>{if(first){first=false;await blocked}}});
 const old=t.api.pullResourceFiles([{id:'old',kind:'file'}]);
 await t.api.pullResourceFiles([{id:'new',kind:'file'}]);release();await old;
 assert.deepEqual(t.calls.map(c=>c.args.resourceId),['new']);assert.equal(t.timers.size,0);
});

test('metadata replaced during a status read requires fresh proof before copying the new intake',async()=>{
 let release;const blocked=new Promise(resolve=>release=resolve);let first=true;
 const t=load({statusRead:async()=>{if(first){first=false;await blocked}}});
 const old=t.api.pullResourceFiles([{id:'old',kind:'file'}]);
 while(!t.statusReads())await Promise.resolve();
 await t.api.pullResourceFiles([{id:'new',kind:'file'}]);release();await old;
 assert.equal(t.calls.length,0);await t.next();
 assert.equal(t.statusReads(),2);assert.deepEqual(t.calls.map(c=>c.args.resourceId),['new']);assert.equal(t.timers.size,0);
});
