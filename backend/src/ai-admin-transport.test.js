import test from 'node:test';
import assert from 'node:assert/strict';
import {mayTransmitAiKey} from './ai-admin-transport.js';
import express from 'express';
import {createAiSettingsRouter} from './routes/ai-settings.js';
import {request as httpRequest} from 'node:http';

const request=(peer,hostname='localhost',secure=false)=>({secure,hostname,socket:{remoteAddress:peer}});
test('key administration requires HTTPS or real server loopback by default',()=>{
 assert.equal(mayTransmitAiKey(request('203.0.113.7','lab.example',true),''),true);
 for(const peer of ['127.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(mayTransmitAiKey(request(peer),''),true);
 for(const peer of ['172.21.0.1','192.168.1.2','203.0.113.7',undefined])assert.equal(mayTransmitAiKey(request(peer),''),false);
});
test('explicit Docker relay trust is exact and requires a loopback hostname',()=>{
 assert.equal(mayTransmitAiKey(request('172.21.0.1'),'172.21.0.1'),true);
 assert.equal(mayTransmitAiKey(request('::ffff:172.21.0.1','127.0.0.1'),'172.21.0.1'),true);
 assert.equal(mayTransmitAiKey(request('172.21.0.2'),'172.21.0.1'),false);
 assert.equal(mayTransmitAiKey(request('172.21.0.1','lab.example'),'172.21.0.1'),false);
 assert.equal(mayTransmitAiKey(request('172.21.0.1','lab.example'),'172.21.0.1,203.0.113.1'),false);
});
test('forwarded headers and malformed relay policy cannot grant plaintext trust',()=>{
 const req={...request('203.0.113.7'),headers:{'x-forwarded-for':'127.0.0.1','x-forwarded-proto':'https'}};
 assert.equal(mayTransmitAiKey(req,'172.21.0.1'),false);
 for(const policy of ['*','172.21.0.0/16','172.21.0.1,invalid','x'.repeat(513),Array(17).fill('172.21.0.1').join(',')])assert.equal(mayTransmitAiKey(request('172.21.0.1'),policy),false);
});
test('actual admin route retains authorization and gates secret saves before the repository',async()=>{
 const previous=process.env.LABOS_AI_TRUSTED_LOOPBACK_PEERS;
 let peer='172.21.0.1',saves=0;
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{Object.defineProperty(req.socket,'remoteAddress',{value:peer,configurable:true});if(req.get('X-Fixture-Role'))req.user={role:req.get('X-Fixture-Role'),userId:'fixture-admin'};next();});
 app.use('/settings',createAiSettingsRouter({service:{repository:{save:async()=>{saves++;return{saved:true};}}}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}/settings`;
 const put=(role='admin',headers={},body={profiles:[{api_key:'synthetic-only-not-a-provider-key'}]})=>new Promise((resolve,reject)=>{const req=httpRequest(base,{method:'PUT',headers:{'Content-Type':'application/json',...(role?{'X-Fixture-Role':role}:{}),...headers}},res=>{res.resume();res.once('end',()=>resolve({status:res.statusCode}));});req.once('error',reject);req.end(JSON.stringify(body));});
 try{
  process.env.LABOS_AI_TRUSTED_LOOPBACK_PEERS='';
  assert.equal((await put(null)).status,401);assert.equal((await put('viewer')).status,403);
  assert.equal((await put()).status,400);assert.equal(saves,0);
  process.env.LABOS_AI_TRUSTED_LOOPBACK_PEERS='172.21.0.1';
  assert.equal((await put()).status,200);assert.equal(saves,1);
  assert.equal((await put('admin',{Host:'lab.example'})).status,400);assert.equal(saves,1);
  peer='203.0.113.7';
  assert.equal((await put('admin',{'X-Forwarded-For':'127.0.0.1','X-Forwarded-Proto':'https'})).status,400);
  assert.equal(saves,1);
  assert.equal((await put('admin',{}, {profiles:[{api_key:''}]})).status,200);assert.equal(saves,2);
 }finally{
  if(previous===undefined)delete process.env.LABOS_AI_TRUSTED_LOOPBACK_PEERS;else process.env.LABOS_AI_TRUSTED_LOOPBACK_PEERS=previous;
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 }
});
