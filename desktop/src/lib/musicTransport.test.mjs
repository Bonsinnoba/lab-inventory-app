import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
function load(file,require){const exports={};vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require,console});return exports;}
class Audio extends EventTarget{
 src='';paused=true;ended=false;currentTime=0;error=null;loads=0;attempts=[];
 load(){this.loads++;this.currentTime=0;this.error=null;this.ended=false;}
 removeAttribute(){this.src='';}
 pause(){const was=this.paused;this.paused=true;if(!was)this.dispatchEvent(new Event('pause'));}
 play(){this.paused=false;this.dispatchEvent(new Event('play'));return new Promise((resolve,reject)=>this.attempts.push({resolve,reject,src:this.src}));}
}
function fixture(){const focus=load('./audioFocus.ts').default;const {MusicTransport,nextMusicTrack}=load('./musicTransport.ts',()=>({default:focus}));const audio=new Audio(),states=[],errors=[];const transport=new MusicTransport(audio,{playing:v=>states.push(v),reset(){},error:e=>errors.push(e)},focus);return{transport,audio,focus,states,errors,nextMusicTrack};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('explicit playback switches between music surfaces without overlapping audio',()=>{
 const f=load('./audioFocus.ts').default,{MusicTransport}=load('./musicTransport.ts',()=>({default:f}));
 const a=new Audio(),b=new Audio(),events={playing(){},reset(){},error(){}};
 const left=new MusicTransport(a,events,f,'left-music'),right=new MusicTransport(b,events,f,'right-music');
 left.select('a','blob:a',true);right.select('b','blob:b',true);assert.equal(a.paused,true);assert.equal(b.paused,false);
 left.play();assert.equal(a.paused,false);assert.equal(b.paused,true);left.dispose();right.dispose();
});

test('pause/resume preserves time without source reload or focus feedback loop',async()=>{
 const {transport:t,audio:a,focus:f,errors}=fixture();t.select('a','blob:a',true);a.attempts[0].resolve();await flush();a.currentTime=19;
 const loads=a.loads,token=f.getCurrentOwner();t.select('a','blob:a',true,false,false);assert.equal(f.getCurrentOwner().generation,token.generation);
 t.toggle();assert.equal(a.paused,true);assert.equal(t.wantsPlayback,false);t.toggle();assert.equal(a.paused,false);assert.equal(a.currentTime,19);assert.equal(a.loads,loads);assert.equal(a.attempts.length,2);assert.deepEqual(errors,[]);t.dispose();
});
test('switching tracks fences late play rejection and loads the selected source first',async()=>{
 const {transport:t,audio:a,errors}=fixture();t.select('a','blob:a',true);t.select('b','blob:b',true);a.attempts[1].resolve();a.attempts[0].reject(Object.assign(Error('old aborted load'),{name:'AbortError'}));await flush();assert.equal(t.currentId,'b');assert.equal(a.src,'blob:b');assert.equal(a.paused,false);assert.equal(t.wantsPlayback,true);assert.deepEqual(errors,[]);t.dispose();
});
test('rapid play/pause/play ignores the cancelled attempt and keeps latest intent',async()=>{
 const {transport:t,audio:a,errors}=fixture();t.select('a','blob:a',true);t.toggle();t.toggle();a.attempts[0].reject(Error('old attempt'));a.attempts[1].resolve();await flush();assert.equal(a.paused,false);assert.equal(t.wantsPlayback,true);assert.deepEqual(errors,[]);t.dispose();
});
test('mini-player commands share manual pause/resume intent without stale button labels',()=>{
 const {transport:t,audio:a}=fixture();t.select('a','blob:a',true);a.currentTime=13;
 a.dispatchEvent(new Event('labos:music-toggle'));assert.equal(a.paused,true);assert.equal(t.wantsPlayback,false);
 a.dispatchEvent(new Event('labos:music-toggle'));assert.equal(a.paused,false);assert.equal(a.currentTime,13);t.dispose();
});
test('higher priority focus pauses music and resumes at the same time once',()=>{
 const {transport:t,audio:a,focus:f}=fixture();t.select('a','blob:a',true);a.currentTime=23;const voice=f.acquire({type:'tts',id:'voice'});assert.equal(a.paused,true);assert.equal(t.wantsPlayback,true);f.release(voice);assert.equal(a.paused,false);assert.equal(a.currentTime,23);assert.equal(a.attempts.length,2);t.dispose();
});
test('manual pause while preempted cancels automatic resume',()=>{
 const {transport:t,audio:a,focus:f}=fixture();t.select('a','blob:a',true);const voice=f.acquire({type:'tts',id:'voice'});t.pause();f.release(voice);assert.equal(a.paused,true);assert.equal(a.attempts.length,1);assert.equal(f.getCurrentOwner(),null);t.dispose();
});
test('selecting another track while preempted resumes that track, never old saved position',()=>{
 const {transport:t,audio:a,focus:f}=fixture();t.select('a','blob:a',true);a.currentTime=55;const video=f.acquire({type:'video',id:'lab-video'});t.select('b','blob:b',true);assert.equal(a.paused,true);f.release(video);assert.equal(a.src,'blob:b');assert.equal(a.currentTime,0);assert.equal(a.paused,false);t.dispose();
});
test('legacy resume cannot override manual pause or an active higher priority owner',()=>{
 const {transport:t,audio:a,focus:f}=fixture();t.select('a','blob:a',true);t.suspendLegacy();const voice=f.acquire({type:'tts',id:'voice'});t.resumeLegacy();assert.equal(a.paused,true);t.pause();f.release(voice);t.resumeLegacy();assert.equal(a.paused,true);t.dispose();
});
test('actual playback failure stays recoverable and cannot poison the next file',async()=>{
 const {transport:t,audio:a,errors}=fixture();t.select('a','blob:a',true);a.attempts[0].reject(Error('unsupported'));await flush();assert.equal(t.wantsPlayback,false);assert.equal(errors.length,1);t.select('b','blob:b',true);a.attempts[1].resolve();await flush();assert.equal(a.paused,false);assert.equal(t.currentId,'b');t.dispose();
});
test('focus reset stops old-session playback and dispose ignores late completion',async()=>{
 const {transport:t,audio:a,focus:f,errors}=fixture();t.select('a','blob:a',true);f.reset();assert.equal(a.paused,true);assert.equal(t.wantsPlayback,false);t.dispose();a.attempts[0].reject(Error('late'));await flush();assert.deepEqual(errors,[]);assert.equal(f.getCurrentOwner(),null);
});
test('previous follows actual play history including shuffled tracks',()=>{
 const {transport:t}=fixture();for(const id of ['a','c','b'])t.select(id,'blob:'+id,false);const previous=t.previous(['a','b','c']);assert.equal(previous,'c');t.select(previous,'blob:c',false,false,false);assert.equal(t.previous(['a','b','c']),'a');t.dispose();
});
test('manual next ignores repeat-one, ended repeat-one restarts, invalid queue entries skip',()=>{
 const {nextMusicTrack:next}=fixture();assert.equal(next(['a','b'],'a',[],false,'one',false).id,'b');assert.equal(next(['a','b'],'a',['b'],false,'one',true).id,'a');const result=next(['a','b'],'a',['missing','b'],false,'off',false);assert.equal(result.id,'b');assert.equal(result.queue.length,0);assert.equal(next(['a','b'],'b',[],false,'off',true).id,null);assert.equal(next(['a','b'],'b',[],false,'off',false).id,'a');
});
test('shuffle avoids current track whenever another valid track exists',()=>{
 const {nextMusicTrack:next}=fixture();assert.equal(next(['a','b'],'a',[],true,'off',false,()=>0).id,'b');assert.equal(next(['a'],'a',[],true,'all',true,()=>0).id,'a');
});
