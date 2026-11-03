import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load(file,require){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,console});return exports;}
class Media extends EventTarget{
 paused=true;currentTime=0;attempts=[];
 play(){this.paused=false;this.dispatchEvent(new Event('play'));return new Promise((resolve,reject)=>this.attempts.push({resolve,reject}));}
 pause(){const changed=!this.paused;this.paused=true;if(changed)this.dispatchEvent(new Event('pause'));}
}
function fixture(){const focus=load('./audioFocus.ts').default;const {ResourceMediaFocus}=load('./resourceMediaFocus.ts',()=>({default:focus}));const {FocusedSpeech}=load('./focusedSpeech.ts',()=>({default:focus}));return{focus,ResourceMediaFocus,FocusedSpeech};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('resource playback suspends music, preserves position through TTS and releases on manual pause',()=>{
 const {focus:f,ResourceMediaFocus}=fixture();const music=f.acquire({type:'music',id:'music'}),m=new Media(),c=new ResourceMediaFocus(m,f);
 m.play();m.currentTime=23;assert.equal(f.getCurrentOwner().type,'video');const speech=f.acquire({type:'tts',id:'tts'});assert.equal(m.paused,true);
 f.release(speech);assert.equal(m.paused,false);assert.equal(m.currentTime,23);assert.equal(m.attempts.length,2);
 m.pause();assert.equal(f.isOwner(music.id,music.generation),true);c.dispose();
});
test('two panes have distinct owners and explicit newer playback takes focus',()=>{
 const {focus:f,ResourceMediaFocus}=fixture();const a=new Media(),b=new Media(),ca=new ResourceMediaFocus(a,f),cb=new ResourceMediaFocus(b,f);
 a.play();const first=f.getCurrentOwner();b.play();assert.equal(a.paused,true);assert.notEqual(f.getCurrentOwner().id,first.id);
 cb.dispose();assert.equal(a.paused,false);ca.dispose();assert.equal(f.getCurrentOwner(),null);
});
test('explicit play in a suspended pane can reclaim equal-priority resource focus',()=>{
 const {focus:f,ResourceMediaFocus}=fixture();const a=new Media(),b=new Media(),ca=new ResourceMediaFocus(a,f),cb=new ResourceMediaFocus(b,f);
 a.play();b.play();assert.equal(a.paused,true);a.play();assert.equal(a.paused,false);assert.equal(b.paused,true);ca.dispose();cb.dispose();assert.equal(f.getCurrentOwner(),null);
});
test('closing suspended pane prevents its later resurrection; reset fences all old playback',()=>{
 const {focus:f,ResourceMediaFocus}=fixture();const m=new Media(),c=new ResourceMediaFocus(m,f);m.play();const mic=f.acquire({type:'microphone',id:'mic'});
 c.dispose();f.release(mic);assert.equal(m.paused,true);assert.equal(f.getCurrentOwner(),null);
 const n=new Media(),d=new ResourceMediaFocus(n,f);n.play();f.reset();assert.equal(n.paused,true);assert.equal(f.getCurrentOwner(),null);d.dispose();
});
test('resource queued behind microphone resumes only after release; failed play releases focus',async()=>{
 const {focus:f,ResourceMediaFocus}=fixture();const mic=f.acquire({type:'microphone',id:'mic'}),m=new Media(),c=new ResourceMediaFocus(m,f);
 m.play();assert.equal(m.paused,true);f.release(mic);assert.equal(m.paused,false);m.attempts[1].reject(Error('unsupported'));await flush();assert.equal(m.paused,true);assert.equal(f.getCurrentOwner(),null);c.dispose();
});
test('resource stale play rejection and queued old pause do not cancel a newer playback intent',async()=>{
 const {focus:f,ResourceMediaFocus}=fixture();const m=new Media(),c=new ResourceMediaFocus(m,f);m.play();const t=f.acquire({type:'tts',id:'t'});f.release(t);
 m.dispatchEvent(new Event('pause'));m.attempts[1].resolve();await flush();assert.equal(m.paused,false);assert.equal(f.getCurrentOwner().type,'video');c.dispose();
});
function speechFixture(){const base=fixture(),utterances=[],states=[],synth={spoken:[],cancelled:0,paused:0,speak(u){this.spoken.push(u);},cancel(){this.cancelled++;},pause(){this.paused++;},resume(){this.paused--;}};const make=()=>new base.FocusedSpeech((...s)=>states.push(s),synth,text=>{const u={text};utterances.push(u);return u;},base.focus);return{...base,synth,utterances,states,make};}
test('old utterance completion cannot release or cancel its replacement',()=>{
 const {focus:f,synth,make,utterances}=speechFixture(),c=make();c.speak('old');const old=utterances[0];c.speak('new');const owner=f.getCurrentOwner(),cancelled=synth.cancelled;
 old.onend();old.onerror();assert.equal(f.isOwner(owner.id,owner.generation),true);assert.equal(synth.cancelled,cancelled);c.dispose();
});
test('new read aloud replaces other TTS; unmounting old reader cannot cancel current speech',()=>{
 const {focus:f,synth,make}=speechFixture(),a=make(),b=make();a.speak('notebook');b.speak('assistant');const owner=f.getCurrentOwner(),cancelled=synth.cancelled;
 a.dispose();assert.equal(synth.cancelled,cancelled);assert.equal(f.isOwner(owner.id,owner.generation),true);b.dispose();assert.equal(f.getCurrentOwner(),null);
});
test('microphone cancels running TTS and account reset prevents queued speech',()=>{
 const {focus:f,synth,make}=speechFixture(),c=make();c.speak('stop on microphone');const mic=f.acquire({type:'microphone',id:'mic'});assert.equal(synth.cancelled,1);
 c.speak('queued');assert.equal(synth.spoken.length,1);f.reset();f.release(mic);assert.equal(synth.spoken.length,1);c.dispose();
});
test('speech waits for exclusive microphone then supports scoped pause/resume and error release',()=>{
 const {focus:f,synth,make,utterances}=speechFixture(),mic=f.acquire({type:'microphone',id:'mic'}),c=make();c.speak('queued');assert.equal(synth.spoken.length,0);
 f.release(mic);assert.equal(synth.spoken.length,1);c.pause();assert.equal(synth.paused,1);c.resume();assert.equal(synth.paused,0);utterances[0].onerror();assert.equal(f.getCurrentOwner(),null);c.dispose();
});
