import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load({token='server',http=async()=>({ok:true,json:async()=>({text:'review',review_required:true})})}={}){
 let account='a';const calls=[],exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(new URL('./assistant-voice.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Blob,FormData,require:name=>{
  if(name==='./auth')return{captureAccountSession:()=>({accountId:account}),isAccountSessionCurrent:s=>s.accountId===account,getToken:()=>token};
  if(name==='./http')return{apiFetch:async(...args)=>{calls.push(args);return http(...args);},getApiErrorMessage:async()=> 'voice unavailable'};
  throw Error(name);
 }});return{api:exports,calls,switchAccount(){account='b';}};
}
test('local login never uploads voice or requests provider capabilities',async()=>{
 const c=load({token:'local:lease'});await assert.rejects(c.api.getVoiceCapabilities(),/online sign-in/);await assert.rejects(c.api.transcribeVoice(new Blob(['audio']),'consent',new AbortController().signal),/online sign-in/);assert.equal(c.calls.length,0);
});
test('voice upload carries explicit consent and returns reviewable text without another request',async()=>{
 const c=load();assert.equal(await c.api.transcribeVoice(new Blob(['audio'],{type:'audio/webm'}),'consent-id',new AbortController().signal),'review');assert.equal(c.calls.length,1);assert.equal(c.calls[0][1].method,'POST');assert.equal(c.calls[0][1].body.get('consent'),'consent-id');assert.equal(c.calls[0][1].body.get('audio').size,5);
});
test('cancel before upload sends nothing; late transcript after account switch is rejected',async()=>{
 const cancelled=load(),controller=new AbortController();controller.abort();await assert.rejects(cancelled.api.transcribeVoice(new Blob(['audio']),'id',controller.signal),/cancelled/);assert.equal(cancelled.calls.length,0);
 let c;c=load({http:async()=>({ok:true,json:async()=>{c.switchAccount();return{text:'stale',review_required:true};}})});await assert.rejects(c.api.transcribeVoice(new Blob(['audio']),'id',new AbortController().signal),/session changed/);
});
test('unconfirmed transcript and malformed capabilities fail closed',async()=>{
 const c=load({http:async()=>({ok:true,json:async()=>({text:'not reviewed'})})});await assert.rejects(c.api.transcribeVoice(new Blob(['audio']),'id',new AbortController().signal),/not confirmed/);await assert.rejects(c.api.getVoiceCapabilities(),/incomplete/);
});
