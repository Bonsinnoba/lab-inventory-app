import coordinator from './audioFocus';

type Focus=Pick<typeof coordinator,'subscribe'|'acquire'|'release'|'isOwner'>;
type Token={id:string;generation:number};
let sequence=0;

/** Native media controls own intent; automatic pauses must not erase it. */
export class ResourceMediaFocus {
 private token:Token|null=null;
 private wanted=false;
 private automaticPause=false;
 private pending=false;
 private disposed=false;
 private request=0;
 private acquiring=false;
 private readonly id=`resource-media-${++sequence}`;
 private unsubscribe:()=>void;
 constructor(private media:HTMLMediaElement,private focus:Focus=coordinator){
  media.addEventListener('play',this.onPlay);
  media.addEventListener('pause',this.onPause);
  media.addEventListener('ended',this.stop);
  media.addEventListener('error',this.stop);
  this.unsubscribe=focus.subscribe(state=>{
   if(this.disposed||this.acquiring||!this.token)return;
   if(this.owns()){if(this.wanted&&media.paused)this.resume();}
   else if(state.suspendedOwners.get(this.token.id)?.owner.generation===this.token.generation)this.interrupt();
   else this.stop();
  });
 }
 private owns(){return !!this.token&&this.focus.isOwner(this.token.id,this.token.generation);}
 private onPlay=()=>{
  if(this.disposed)return;
  this.automaticPause=false;this.wanted=true;
  if(!this.token||!this.owns()){
   this.acquiring=true;
   try{this.token=this.focus.acquire({type:'video',id:this.id,replaceEqual:true,onPreempt:()=>this.interrupt()});}
   finally{this.acquiring=false;}
  }
  if(!this.owns())this.interrupt();
 };
 private onPause=()=>{
  // Queued pause events can arrive after a newer play event.
  if(!this.media.paused||this.automaticPause)return;
  this.stop();
 };
 private interrupt(){
  this.request++;this.pending=false;this.automaticPause=true;this.media.pause();
 }
 private resume(){
  if(this.disposed||this.pending||!this.wanted||!this.owns())return;
  this.automaticPause=false;this.pending=true;const request=++this.request;
  try{Promise.resolve(this.media.play()).then(()=>{
   if(this.disposed||request!==this.request)return;
   this.pending=false;if(!this.wanted||!this.owns())this.interrupt();
  },()=>{if(!this.disposed&&request===this.request)this.stop();});}
  catch{this.stop();}
 }
 stop=()=>{
  this.wanted=false;this.interrupt();const token=this.token;this.token=null;
  if(token)this.focus.release(token);
 };
 dispose(){
  if(this.disposed)return;this.disposed=true;this.unsubscribe();this.stop();
  this.media.removeEventListener('play',this.onPlay);this.media.removeEventListener('pause',this.onPause);
  this.media.removeEventListener('ended',this.stop);this.media.removeEventListener('error',this.stop);
 }
}
