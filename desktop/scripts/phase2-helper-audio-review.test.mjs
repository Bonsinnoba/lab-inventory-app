import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';

// Primary-review regression cases. These test the required contract; failures
// are review blockers, not acceptance passes for the helper's implementation.
function coordinator(){
  const exports={};
  const source=ts.transpileModule(readFileSync(new URL('../src/lib/audioFocus.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  vm.runInNewContext(source,{exports,console});
  return exports.default;
}

test('preempting TTS must notify the displaced music owner, not the incoming owner',()=>{
  const focus=coordinator();let musicStopped=0,incomingStopped=0;
  focus.acquire({type:'music',id:'music',onPreempt:()=>{musicStopped++;}});
  focus.acquire({type:'tts',id:'tts',onPreempt:()=>{incomingStopped++;}});
  assert.equal(musicStopped,1,'music must be notified to stop');
  assert.equal(incomingStopped,0,'new TTS owner must not receive its own preemption callback');
});

test('a stale token from before account reset cannot release the next session owner',()=>{
  const focus=coordinator();
  const old=focus.acquire({type:'music',id:'music-dock'});
  focus.reset();
  const current=focus.acquire({type:'music',id:'music-dock'});
  focus.release(old);
  assert.equal(focus.isOwner(current.id,current.generation),true);
});

// Migrated helper cases use the repository's existing Node runner, not Jest
// globals in application sources. Expectations follow the ownership contract.
test('acquire creates an owner and reacquire invalidates its old token',()=>{
  const f=coordinator(),old=f.acquire({type:'music',id:'music'});
  assert.ok(old.generation>0);assert.equal(f.getCurrentOwner().type,'music');
  const next=f.acquire({type:'music',id:'music'});
  assert.ok(next.generation>old.generation);assert.equal(f.isOwner(old.id,old.generation),false);
  assert.equal(f.isOwner(next.id,next.generation),true);
  assert.equal(f.isOwner('missing',1),false);
  f.release(old);assert.equal(f.isOwner(next.id,next.generation),true);
});

test('priority is microphone > TTS > resource video > music with ordered resume',()=>{
  const f=coordinator(),tokens=['music','video','tts','microphone'].map(type=>f.acquire({type,id:type}));
  assert.equal(f.getState().suspendedOwners.size,3);
  for(const token of tokens.reverse()) {
    assert.equal(f.isOwner(token.id,token.generation),true);
    f.release(token);
  }
  assert.equal(f.getCurrentOwner(),null);
});

test('lower and equal priority requests never displace current focus',()=>{
  const f=coordinator(),tts=f.acquire({type:'tts',id:'tts'});
  const music=f.acquire({type:'music',id:'music'}),other=f.acquire({type:'tts',id:'other'});
  assert.equal(f.isOwner(tts.id,tts.generation),true);
  for(const token of [music,other]) {
    assert.equal(f.isOwner(token.id,token.generation),false);
    assert.equal(f.requestResume(token.id,token.generation),false);
  }
});

test('allowPreempt false waits; explicit higher-priority resume notifies displaced owner',()=>{
  const f=coordinator();let stoppedBy;
  const music=f.acquire({type:'music',id:'music',onPreempt:owner=>{stoppedBy=owner.id;}});
  const tts=f.acquire({type:'tts',id:'tts',allowPreempt:false});
  assert.equal(f.isOwner(music.id,music.generation),true);assert.equal(stoppedBy,undefined);
  assert.equal(f.requestResume(tts.id,tts.generation),true);assert.equal(stoppedBy,'tts');
  assert.equal(f.requestResume(tts.id,tts.generation),true);
  assert.equal(f.requestResume('missing',1),false);
});

test('manual release of suspended music removes it from automatic resume',()=>{
  const f=coordinator(),music=f.acquire({type:'music',id:'music'}),tts=f.acquire({type:'tts',id:'tts'});
  f.release({...music,suspensionReason:'manual'});
  assert.equal(f.getState().suspendedOwners.has('music'),false);
  f.release(tts);assert.equal(f.getCurrentOwner(),null);
});

test('replacing a suspended owner invalidates its old token and resumes only the new one',()=>{
  const f=coordinator(),old=f.acquire({type:'music',id:'music'}),tts=f.acquire({type:'tts',id:'tts'});
  const next=f.acquire({type:'music',id:'music'});
  f.release(old);f.release(tts);
  assert.equal(f.isOwner(next.id,next.generation),true);
});

test('subscribe and unsubscribe work without exposing mutable ownership state',()=>{
  const f=coordinator();let calls=0;
  const unsubscribe=f.subscribe(state=>{calls++;state.currentOwner.id='tampered';state.suspendedOwners.clear();});
  f.acquire({type:'music',id:'music'});f.acquire({type:'tts',id:'tts'});
  assert.equal(calls,2);assert.equal(f.getCurrentOwner().id,'tts');
  assert.equal(f.getState().suspendedOwners.size,1);
  const copy=f.getState();copy.suspendedOwners.get('music').owner.id='tampered';
  assert.equal(f.getState().suspendedOwners.get('music').owner.id,'music');
  unsubscribe();f.reset();assert.equal(calls,2);
  assert.equal(f.getCurrentOwner(),null);assert.equal(f.getState().suspendedOwners.size,0);
});

test('preemption callbacks are replaced on reacquire and discarded on reset',()=>{
  const f=coordinator();let oldCalls=0,newCalls=0;
  f.acquire({type:'music',id:'music',onPreempt:()=>oldCalls++});
  f.acquire({type:'music',id:'music',onPreempt:()=>newCalls++});
  f.acquire({type:'tts',id:'tts'});assert.equal(oldCalls,0);assert.equal(newCalls,1);
  f.reset();f.acquire({type:'music',id:'music'});f.acquire({type:'tts',id:'tts'});
  assert.equal(newCalls,1);
});
