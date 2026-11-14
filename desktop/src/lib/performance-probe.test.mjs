import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function fixture(enabled){
 let now=0;const calls=[],timers=new Map(),listeners=new Map(),observers=[];
 class Observer{static supportedEntryTypes=['event','longtask'];constructor(callback){this.callback=callback;observers.push(this);}observe(options){this.type=options.type;}disconnect(){this.disconnected=true;}}
 const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./performance-probe.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,PerformanceObserver:Observer,performance:{now:()=>now},document:{visibilityState:'visible'},window:{setInterval:(fn,ms)=>{timers.set(ms,fn);return ms;},clearInterval:id=>timers.delete(id),addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)},require:name=>name==='./runtime'?{isTauriRuntime:()=>true}:{invoke:async(command,args)=>{calls.push({command,...args});return args.sample===null?enabled:false;}}});
 return {api:exports,calls,timers,listeners,observers,time(value){now=value;}};
}
test('diagnostics opt-out installs no observers, listeners or timers and writes no samples',async()=>{
 const f=fixture(false);await f.api.startPerformanceProbe();assert.equal(f.calls.length,1);assert.equal(f.calls[0].sample,null);assert.equal(f.timers.size+f.listeners.size+f.observers.length,0);
});
test('diagnostics measure stalls and deduplicate interactions without recording input contents; native stop cleans up',async()=>{
 const f=fixture(true);await f.api.startPerformanceProbe();
 f.listeners.get('keydown')({key:'private contents must never be recorded'});
 f.observers.find(o=>o.type==='event').callback({getEntries:()=>[{interactionId:1,duration:240,name:'private target'},{interactionId:1,duration:320}]});
 f.observers.find(o=>o.type==='longtask').callback({getEntries:()=>[{duration:1250}]});
 f.time(1300);f.timers.get(100)();await f.timers.get(5000)();
 const sample=f.calls.at(-1).sample;assert.equal(sample.input_count,1);assert.equal(sample.observed_interactions,1);assert.equal(sample.event_p95_ms,320);assert.equal(sample.long_task_max_ms,1250);assert.equal(sample.heartbeat_max_ms,1200);
 assert.doesNotMatch(JSON.stringify(f.calls),/private|contents|target/);assert.equal(f.timers.size+f.listeners.size,0);assert.ok(f.observers.every(o=>o.disconnected));
});
