// Actual PostgreSQL + production auth/upload/router. Provider is deliberately
// stubbed: this verifies privacy/authorization, not live transcription quality.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
import {authenticateToken} from './middleware/auth.js';
import {createAssistantVoiceRouter} from './routes/assistant-voice.js';
import {transcriptionSettings,VOICE_MAX_BYTES} from './assistant-transcription.js';
if(process.env.LABOS_DEV_VOICE_PROBE!=='rollback-only')throw Error('Explicit rollback-only opt-in required');
const c=await pool.connect(),originalQuery=pool.query,users=[randomUUID(),randomUUID(),randomUUID()];let server,mode='success',providerCalls=0,startedResolve;const buffers=[];
try{
 await c.query('BEGIN');
 for(const id of users)await c.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'no-login','member',true)",[id,`voice-probe-${id}`]);
 pool.query=(...args)=>c.query(...args);
 const capabilities=transcriptionSettings({LABOS_TRANSCRIPTION_ENABLED:'true',GEMINI_API_KEY:'fake-only',GEMINI_TRANSCRIPTION_MODEL:'stub-model',LABOS_TRANSCRIPTION_PROVIDER_POLICY:'Fixture disclosure only; provider is stubbed'});
 const app=express();app.use('/voice',authenticateToken,createAssistantVoiceRouter({settings:()=>capabilities,transcribe:async({buffer,signal})=>{
  providerCalls++;buffers.push(buffer);
  if(mode==='provider-error')throw Object.assign(Error('unsafe-provider-detail-secret'),{status:400});
  if(mode==='revoke')await c.query('UPDATE users SET is_active=false WHERE id=$1',[users[0]]);
  if(mode==='cancel'){startedResolve();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}
  return 'Review this fixture transcript';
 }}));app.use((error,req,res,next)=>res.status(error.status||500).json({error:{code:error.code||'PROBE_ERROR'}}));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 async function token(id){const version=(await c.query('SELECT credential_version FROM users WHERE id=$1',[id])).rows[0].credential_version;return jwt.sign({userId:id,credentialVersion:version},config.jwtSecret,{expiresIn:'5m'});}
 const first=await token(users[0]);
 async function request({consent=capabilities.disclosure_id,mime='audio/webm',bytes=Buffer.from('fixture-audio'),bearer=first,signal=AbortSignal.timeout(20000)}={}){
  const body=new FormData();body.append('consent',consent);body.append('audio',new Blob([bytes],{type:mime}),'recording.webm');return fetch(`http://127.0.0.1:${server.address().port}/voice/transcribe`,{method:'POST',headers:{Authorization:`Bearer ${bearer}`},body,signal});
 }
 const conversations=Number((await c.query('SELECT count(*) AS n FROM conversation_messages')).rows[0].n);
 for(const [options,status] of [[{consent:'old-or-absent'},409],[{mime:'text/plain'},400],[{bytes:Buffer.alloc(0)},400],[{bytes:Buffer.alloc(VOICE_MAX_BYTES+1)},413]])assert.equal((await request(options)).status,status);
 assert.equal(providerCalls,0);
 const response=await request();assert.equal(response.status,200);assert.deepEqual(await response.json(),{text:'Review this fixture transcript',review_required:true});assert.equal(providerCalls,1);assert.ok(buffers[0].every(byte=>byte===0));
 mode='revoke';assert.equal((await request()).status,401);assert.equal(providerCalls,2);assert.ok(buffers[1].every(byte=>byte===0));
 await c.query('UPDATE users SET is_active=true WHERE id=$1',[users[0]]);assert.equal((await request({bearer:await token(users[0])})).status,429);
 mode='cancel';const started=new Promise(resolve=>startedResolve=resolve),controller=new AbortController();const call=request({bearer:await token(users[1]),signal:controller.signal}).then(value=>({value}),error=>({error}));
 await started;controller.abort();assert.ok((await call).error);
 const deadline=Date.now()+3000;while(!buffers.at(-1).every(byte=>byte===0)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(buffers.at(-1).every(byte=>byte===0));assert.equal(providerCalls,3);
 mode='provider-error';const failed=await request({bearer:await token(users[2])});assert.equal(failed.status,502);assert.ok(!JSON.stringify(await failed.json()).includes('unsafe-provider-detail-secret'));assert.ok(buffers.at(-1).every(byte=>byte===0));
 assert.equal(Number((await c.query('SELECT count(*) AS n FROM conversation_messages')).rows[0].n),conversations);
 console.log('PASS: actual PostgreSQL production auth/multipart route enforces consent, type/size, per-account rate limit, post-provider revocation and cancellation; buffers cleared, no chat submission. Provider stubbed, live quality/hardware NOT verified.');
}finally{
 if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});pool.query=originalQuery;
 try{await c.query('ROLLBACK');assert.equal((await c.query('SELECT 1 FROM users WHERE id=ANY($1::uuid[])',[users])).rowCount,0);console.log('PASS: voice fixtures rolled back.');}finally{c.release();await pool.end();}
}
