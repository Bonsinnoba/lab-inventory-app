import test from 'node:test';
import assert from 'node:assert/strict';
import {runMediaProcess} from './media-process.js';

// Real child processes; no network, downloader credentials or permanent files.
const run=(source,options={})=>runMediaProcess(process.execPath,['-e',source],{processes:new Map(),...options});
test('real noisy process drains both pipes with bounded retained output',async()=>{
 const processes=new Map();const result=await run("process.stdout.write('x'.repeat(200000));process.stderr.write('y'.repeat(200000));",{jobId:'noise',processes});
 assert.equal(result.stdout.length,65536);assert.equal(result.stderr.length,65536);assert.equal(processes.size,0);
});
test('real timeout terminates child and clears only its owned job',async()=>{
 const processes=new Map();let child;
 await assert.rejects(run('setInterval(()=>{},1000)',{jobId:'hung',processes,timeoutMs:150,terminate:(target,force)=>{child=target;assert.equal(force,true);target.kill();}}),/timed out/);
 assert.ok(child);assert.ok(child.exitCode!==null||child.signalCode!==null);assert.equal(processes.size,0);
});
test('real process failure retains bounded error context and releases job',async()=>{
 const processes=new Map();await assert.rejects(run("process.stderr.write('diagnostic\\nfinal error');process.exitCode=7",{jobId:'failure',processes}),e=>e.code===7&&e.message==='final error');assert.equal(processes.size,0);
});
test('exiting real process cannot remove a replacement owner',async()=>{
 const processes=new Map(),replacement={owner:'replacement'};
 const pending=run('setTimeout(()=>{},100)',{jobId:'reused',processes});processes.set('reused',replacement);await pending;assert.equal(processes.get('reused'),replacement);
});
test('failed progress persistence does not reject a completed real process',async()=>{
 let calls=0;await run("console.log('download:42')",{parseProgress:line=>line==='download:42'?{progress:42}:null,onProgress:async()=>{calls++;throw Error('observer unavailable');}});assert.equal(calls,1);
});
