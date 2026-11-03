import coordinator from './audioFocus';
type Focus=Pick<typeof coordinator,'subscribe'|'acquire'|'release'|'isOwner'>;
type Token={id:string;generation:number};
let sequence=0;

/** One scoped utterance. Old completion/cancel events cannot stop newer speech. */
export class FocusedSpeech {
 private token:Token|null=null;
 private utterance:SpeechSynthesisUtterance|null=null;
 private started=false;
 private disposed=false;
 private acquiring=false;
 private unsubscribe:()=>void;
 private readonly id=`speech-${++sequence}`;
 constructor(private changed:(speaking:boolean,paused:boolean)=>void,private synth:SpeechSynthesis=window.speechSynthesis,private create:(text:string)=>SpeechSynthesisUtterance=text=>new SpeechSynthesisUtterance(text),private focus:Focus=coordinator){
  this.unsubscribe=focus.subscribe(state=>{
   if(this.disposed||this.acquiring||!this.token)return;
   if(this.owns())this.start();
   else if(state.suspendedOwners.get(this.token.id)?.owner.generation!==this.token.generation)this.stop();
  });
 }
 private owns(){return !!this.token&&this.focus.isOwner(this.token.id,this.token.generation);}
 speak(text:string){
  if(this.disposed||!text.trim())return;
  this.stop();const utterance=this.create(text);this.utterance=utterance;
  const done=()=>{if(this.utterance===utterance)this.stop();};
  utterance.onend=done;utterance.onerror=done;
  this.acquiring=true;
  try{this.token=this.focus.acquire({type:'tts',id:this.id,replaceEqual:true,onPreempt:()=>this.stop()});}
  finally{this.acquiring=false;}
  this.start();
 }
 private start(){
  if(this.disposed||this.started||!this.utterance||!this.owns())return;
  this.started=true;this.changed(true,false);
  try{this.synth.speak(this.utterance);}catch{this.stop();}
 }
 pause(){if(this.started&&this.owns()){this.synth.pause();this.changed(true,true);}}
 resume(){if(this.started&&this.owns()){this.synth.resume();this.changed(true,false);}}
 stop(){
  const token=this.token,started=this.started;
  this.token=null;this.utterance=null;this.started=false;
  if(started)this.synth.cancel();
  if(token)this.focus.release(token);
  if(!this.disposed)this.changed(false,false);
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.unsubscribe();this.stop();}
}
