import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter,once} from 'node:events';
import express from 'express';
import {createServerPerformanceProbe} from './performance-probe.js';

test('disabled server diagnostics never subscribe, sample or log',()=>{
 const probe=createServerPerformanceProbe({write:()=>{throw Error('Must not log');}});
 const res=new EventEmitter();let next=0;probe.middleware({},res,()=>next++);
 assert.equal(next,1);assert.equal(res.eventNames().length,0);assert.equal(probe.flush(),null);probe.stop();
});

test('bounded numeric samples count finish/close once, preserve aborts and clear per interval',()=>{
 let time=0;const writes=[];
 const probe=createServerPerformanceProbe({enabled:true,clock:()=>time,write:s=>writes.push(s)});
 try{
  for(let i=0;i<1100;i++){
   const res=new EventEmitter();res.statusCode=i===1099?503:200;res.writableFinished=true;
   probe.middleware({path:'/api/resources/private-file?token=private-token'},res,()=>{});
   time++;res.emit('finish');res.emit('close');assert.equal(res.eventNames().length,0);
  }
  const aborted=new EventEmitter();aborted.statusCode=200;aborted.writableFinished=false;
  probe.middleware({path:'/api/sync/secret-account'},aborted,()=>{});time+=30;aborted.emit('close');
  const first=probe.flush();assert.equal(first.routes.resources.requests,1100);assert.equal(first.routes.resources.sample_count,512);
  assert.equal(first.routes.resources.errors,1);assert.equal(first.routes.resources.max_ms,1);assert.equal(first.routes.sync.aborted,1);assert.equal(first.active_requests,0);
  assert.equal(first.routes.sync.max_ms,30);assert.doesNotMatch(JSON.stringify(first),/private|secret|token|file/);
  assert.deepEqual(probe.flush().routes,{});assert.equal(writes.length,2);
 }finally{probe.stop();}
 assert.equal(probe.flush(),null);
});

test('unknown paths have fixed cardinality, unfinished requests remain active, logger failures are isolated',()=>{
 const probe=createServerPerformanceProbe({enabled:true,write:()=>{throw Error('Log storage unavailable');}});
 try{
  const res=new EventEmitter();res.statusCode=429;res.writableFinished=true;
  probe.middleware({path:'/api/arbitrary-unique-id/private-document'},res,()=>{});
  assert.equal(probe.flush().active_requests,1);res.emit('finish');
  const sample=probe.flush();assert.deepEqual(Object.keys(sample.routes),['other']);assert.equal(sample.routes.other.throttled,1);
  assert.ok(Number.isFinite(sample.cpu_core_percent));assert.ok(Number.isFinite(sample.event_loop_p95_ms));
 }finally{probe.stop();}
});

test('actual HTTP responses and aborted sockets retain API behavior without exposing diagnostic endpoints',async()=>{
 const captured=[];const probe=createServerPerformanceProbe({enabled:true,write:s=>captured.push(s)});
 const app=express();app.use(probe.middleware);
 app.get('/api/items/:id',(_req,res)=>res.status(201).json({ok:true}));
 app.get('/api/reports/wait',(_req,res)=>{res.flushHeaders();});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const response=await fetch(base+'/api/items/private-id?token=not-recorded');
  assert.equal(response.status,201);assert.deepEqual(await response.json(),{ok:true});
  assert.equal((await fetch(base+'/api/performance')).status,404);
  await new Promise((resolve,reject)=>{
   const request=http.get(base+'/api/reports/wait',res=>{res.destroy();resolve();});request.on('error',reject);
  });
  // The client close arrives asynchronously at the server; await its event.
  for(let i=0;i<20;i++){await new Promise(resolve=>setTimeout(resolve,5));if(probe.flush().active_requests===0)break;}
  const sample=probe.flush();assert.equal(sample.active_requests,0);
  assert.equal(captured.reduce((sum,s)=>sum+(s.routes.reports?.aborted||0),0),1);
  assert.equal(captured.reduce((sum,s)=>sum+(s.routes.items?.requests||0),0),1);
  assert.doesNotMatch(JSON.stringify(captured),/private-id|not-recorded/);
 }finally{
  probe.stop();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 }
});
