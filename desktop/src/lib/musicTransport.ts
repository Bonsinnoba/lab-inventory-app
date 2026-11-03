import focusCoordinator from './audioFocus';
type Focus=Pick<typeof focusCoordinator,'subscribe'|'acquire'|'release'|'isOwner'|'getState'>;
type Token={id:string;generation:number};
type Events={playing:(value:boolean)=>void;reset:()=>void;error:(message:string)=>void};

/** One media element, one intent, one focus token. React renders never own playback. */
export class MusicTransport{
 private owner:Token|null=null;
 private request=0;
 private pending=false;
 private wanted=false;
 private acquiring=false;
 private legacyBlocked=false;
 private disposed=false;
 private source='';
 private track:string|null=null;
 private history:string[]=[];
 private unsubscribe:()=>void;
 private listeners:Array<[string,()=>void]>=[];
 autoPause=true;
 constructor(private audio:HTMLAudioElement,private events:Events,private focus:Focus=focusCoordinator,private ownerId='music-dock'){
  const listen=(name:string,handler:()=>void)=>{audio.addEventListener(name,handler);this.listeners.push([name,handler]);};
  listen('labos:music-toggle',()=>this.toggle());
  listen('play',()=>{if(!this.wanted||!this.ownsFocus()||this.legacyBlocked){audio.pause();this.events.playing(false);}else this.events.playing(true);});
  listen('pause',()=>{if(audio.paused)this.events.playing(false);});
  listen('error',()=>{if(audio.error&&audio.error.code!==1)this.fail(audio.error.code===4?'This audio format is not supported by this device. Try another file or convert it to MP3/WAV.':'Unable to read this audio file. You can retry it or choose another track.');});
  this.unsubscribe=focus.subscribe(state=>{
   if(this.disposed||this.acquiring||!this.owner)return;
   if(this.ownsFocus()){if(this.wanted&&!this.legacyBlocked&&audio.paused)this.start();}
   else if(!state.suspendedOwners.has(this.owner.id)){this.pause();}
   else{this.interrupt();}
  });
 }
 get currentId(){return this.track;}
 get wantsPlayback(){return this.wanted;}
 private ownsFocus(){return !!this.owner&&this.focus.isOwner(this.owner.id,this.owner.generation);}
 private interrupt(){this.request++;this.pending=false;this.audio.pause();this.events.playing(false);}
 private release(){const owner=this.owner;this.owner=null;if(owner)this.focus.release({...owner,suspensionReason:'manual'});}
 private fail(message:string){if(this.disposed)return;this.wanted=false;this.interrupt();this.release();this.events.error(message);}
 select(id:string|null,source:string,autoplay:boolean,restart=false,remember=true){
  if(this.disposed)return;
  const changed=id!==this.track||source!==this.source;
  if(changed){
   if(remember&&this.track&&id&&this.track!==id)this.history.push(this.track);
   this.interrupt();this.track=id;this.source=source;this.events.reset();
   if(source)this.audio.src=source;else this.audio.removeAttribute('src');
   this.audio.load();
  }
  if(restart&&source){this.interrupt();this.audio.currentTime=0;}
  if(autoplay&&source)this.play();else if(changed)this.pause();
 }
 play(){
  if(this.disposed||!this.source)return;
  this.wanted=true;
  if(!this.owner||!this.ownsFocus()){
   // acquire notifies synchronously; publish the returned token before reacting.
   this.acquiring=true;
   try{this.owner=this.focus.acquire({type:'music',id:this.ownerId,allowPreempt:true,replaceEqual:true});}finally{this.acquiring=false;}
  }
  this.start();
 }
 private start(){
  if(this.disposed||!this.wanted||this.pending||!this.ownsFocus()||this.legacyBlocked||!this.source)return;
  if(!this.audio.paused&&!this.audio.ended)return;
  if(this.audio.ended)this.audio.currentTime=0;
  if(this.audio.error)this.audio.load();
  const request=++this.request;this.pending=true;
  try{
   Promise.resolve(this.audio.play()).then(()=>{
    if(request!==this.request||this.disposed)return;
    this.pending=false;
    if(!this.wanted||!this.ownsFocus()||this.legacyBlocked)this.interrupt();
   },error=>{
    if(request!==this.request||this.disposed)return;
    this.pending=false;
    this.fail(error?.name==='NotAllowedError'?'Playback was blocked. Press Play again to start this track.':'Unable to play this track. Try it again or select another audio file.');
   });
  }catch{if(request===this.request){this.pending=false;this.fail('Unable to play this track.');}}
 }
 pause(){this.wanted=false;this.legacyBlocked=false;this.interrupt();this.release();}
 toggle(){if(this.wanted&&this.ownsFocus()&&!this.legacyBlocked)this.pause();else this.play();}
 suspendLegacy(){if(this.autoPause){this.legacyBlocked=true;this.interrupt();}}
 resumeLegacy(){this.legacyBlocked=false;this.start();}
 setAutoPause(value:boolean){this.autoPause=value;if(!value)this.resumeLegacy();}
 previous(ids:string[]):string|null{
  while(this.history.length){const id=this.history.pop()!;if(id!==this.track&&ids.includes(id))return id;}
  const index=ids.indexOf(this.track||'');return ids.length?ids[(Math.max(0,index)-1+ids.length)%ids.length]:null;
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.wanted=false;this.unsubscribe();for(const [name,handler]of this.listeners)this.audio.removeEventListener(name,handler);this.interrupt();this.release();this.audio.removeAttribute('src');this.audio.load();}
}

export function nextMusicTrack(ids:string[],current:string|null,queue:string[],shuffle:boolean,repeat:'off'|'all'|'one',ended:boolean,random=Math.random):{id:string|null;queue:string[]}{
 const valid=queue.filter(id=>ids.includes(id));
 if(ended&&repeat==='one')return{id:current,queue:valid};
 if(valid.length)return{id:valid[0],queue:valid.slice(1)};
 if(!ids.length)return{id:null,queue:[]};
 if(shuffle){const candidates=ids.filter(id=>id!==current);return{id:candidates.length?candidates[Math.min(candidates.length-1,Math.floor(random()*candidates.length))]:ids[0],queue:[]};}
 const next=ids[ids.indexOf(current||'')+1];return{id:next||(!ended||repeat==='all'?ids[0]:null),queue:[]};
}
