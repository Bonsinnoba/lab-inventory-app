import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {runMediaProcess} from './media-process.js';
function fake(){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();return child;}
test('process output is bounded and job tracking clears only the owned process',async()=>{
  const child=fake(),processes=new Map();
  const task=runMediaProcess('ignored',[],{jobId:'job',processes,spawnProcess:()=>child});
  assert.equal(processes.get('job'),child);child.stdout.write('x'.repeat(100000));child.stderr.write('y'.repeat(100000));
  const replacement=fake();processes.set('job',replacement);child.emit('close',0);
  const result=await task;assert.equal(result.stdout.length,65536);assert.equal(result.stderr.length,65536);assert.equal(processes.get('job'),replacement);
});
test('progress is serialized and keeps only the latest waiting observation',async()=>{
  const child=fake(),calls=[];let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const task=runMediaProcess('ignored',[],{processes:new Map(),spawnProcess:()=>child,parseProgress:line=>/^\d+$/.test(line)?Number(line):null,onProgress:async value=>{calls.push(value);if(value===1)await gate;}});
  child.stdout.write('1\n2\n3\n');assert.deepEqual(calls,[1]);release();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[1,3]);
  child.emit('close',0);await task;
});
test('thumbnail deadline forces termination and rejects even if the tool exits zero',async()=>{
  const child=fake(),calls=[];
  const task=runMediaProcess('ignored',[],{processes:new Map(),spawnProcess:()=>child,timeoutMs:5,terminate:(received,force)=>{calls.push(force);assert.equal(received,child);child.emit('close',0);}});
  const rejected=assert.rejects(task,/timed out/);await new Promise(resolve=>setTimeout(resolve,20));await rejected;assert.deepEqual(calls,[true]);
});
test('spawn errors and nonzero exits reject without retaining owned job tracking',async()=>{
  for(const spawnError of [true,false]){
    const child=fake(),processes=new Map();const task=runMediaProcess('ignored',[],{jobId:'job',processes,spawnProcess:()=>child});
    const rejected=assert.rejects(task,spawnError?/spawn failed/:/exit error/);
    if(spawnError)child.emit('error',Error('spawn failed'));else{child.stderr.write('exit error');child.emit('close',1);}
    await rejected;assert.equal(processes.size,0);
  }
});
test('failed progress callbacks do not fail a successfully completed process',async()=>{
  const child=fake();const task=runMediaProcess('ignored',[],{processes:new Map(),spawnProcess:()=>child,parseProgress:()=>({progress:10}),onProgress:async()=>{throw Error('database unavailable');}});
  child.stdout.write('progress\n');child.emit('close',0);await task;
});
