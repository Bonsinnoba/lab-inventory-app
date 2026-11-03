import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load(file,require){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,console,Blob,AbortController,setTimeout,clearTimeout});return exports;}
function fixture({streamPromise,maxBytes=1024,supported=true}={}){
 const focus=load('./audioFocus.ts').default,{VoiceCapture}=load('./voiceCapture.ts',()=>({default:focus}));const states=[],recorders=[],timers=new Map();let stopped=0;
 const stream={getTracks:()=>[{stop(){stopped++;}}]};
 const controller=new VoiceCapture(state=>states.push(state),maxBytes,{getStream:()=>streamPromise||Promise.resolve(stream),supported:()=>supported,focus,setTimer:fn=>{timers.set(1,fn);return 1;},clearTimer:id=>timers.delete(id),recorder:()=>{const recorder={state:'inactive',start(){this.state='recording';},stop(){this.state='inactive';this.onstop?.();}};recorders.push(recorder);return recorder;}});
 return{focus,controller,states,recorders,timers,stream,get stopped(){return stopped;}};
}
test('recording remains local until explicit transcription and stops every microphone track',async()=>{
 const f=fixture();await f.controller.record();const recorder=f.recorders[0];recorder.ondataavailable({data:new Blob(['speech'])});f.controller.stop();assert.equal(f.states.at(-1).phase,'recorded');assert.equal(f.stopped,1);assert.equal(f.focus.getCurrentOwner(),null);assert.equal(f.timers.size,0);
 let uploads=0;await f.controller.transcribe(async blob=>{uploads++;assert.equal(await blob.text(),'speech');return 'review me';});assert.equal(uploads,1);assert.equal(f.states.at(-1).phase,'review');assert.equal(f.states.at(-1).text,'review me');f.controller.dispose();
});
test('cancelling a pending microphone permission request stops its later stream',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r),f=fixture({streamPromise:pending});const recording=f.controller.record();f.controller.cancel();resolve(f.stream);await recording;assert.equal(f.stopped,1);assert.equal(f.recorders.length,0);assert.equal(f.focus.getCurrentOwner(),null);f.controller.dispose();
});
test('account focus reset and microphone preemption cancel capture without a recorded result',async()=>{
 for(const reset of [true,false]){const f=fixture();await f.controller.record();const old=f.recorders[0];if(reset)f.focus.reset();else f.focus.acquire({type:'microphone',id:'other',replaceEqual:true});old.ondataavailable({data:new Blob(['stale'])});old.onstop();assert.equal(f.stopped,1);assert.equal(f.states.at(-1).phase,'idle');assert.ok(!f.states.some(state=>state.phase==='recorded'));f.controller.dispose();}
});
test('late transcript after cancellation is discarded and upload is aborted',async()=>{
 const f=fixture();await f.controller.record();f.recorders[0].ondataavailable({data:new Blob(['speech'])});f.controller.stop();let resolve,signal;const pending=f.controller.transcribe((_blob,s)=>{signal=s;return new Promise(r=>resolve=r);});f.controller.cancel();assert.equal(signal.aborted,true);resolve('old account transcript');await pending;assert.equal(f.states.at(-1).phase,'idle');assert.ok(!f.states.some(state=>state.phase==='review'));f.controller.dispose();
});
test('upload failure retains recording for explicit retry and discloses uncertain transfer',async()=>{
 const f=fixture();await f.controller.record();f.recorders[0].ondataavailable({data:new Blob(['speech'])});f.controller.stop();await f.controller.transcribe(async()=>{throw Error('network');});assert.equal(f.states.at(-1).phase,'recorded');assert.equal(f.states.at(-1).upload_attempted,true);let calls=0;await f.controller.transcribe(async()=>{calls++;return 'recovered';});assert.equal(calls,1);f.controller.dispose();
});
test('size limit, recording timer and unsupported runtime release focus safely',async()=>{
 const large=fixture({maxBytes:2});await large.controller.record();large.recorders[0].ondataavailable({data:new Blob(['too large'])});assert.equal(large.states.at(-1).phase,'error');assert.equal(large.stopped,1);assert.equal(large.focus.getCurrentOwner(),null);large.controller.dispose();
 const timed=fixture();await timed.controller.record();timed.recorders[0].ondataavailable({data:new Blob(['speech'])});timed.timers.get(1)();assert.equal(timed.states.at(-1).phase,'recorded');timed.controller.dispose();
 const absent=fixture({supported:false});await absent.controller.record();assert.equal(absent.states.at(-1).phase,'error');assert.equal(absent.recorders.length,0);absent.controller.dispose();
});
