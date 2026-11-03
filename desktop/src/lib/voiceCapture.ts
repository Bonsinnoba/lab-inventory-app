import coordinator from './audioFocus';
type Phase='idle'|'requesting'|'recording'|'stopping'|'recorded'|'transcribing'|'review'|'error';
export type VoiceState={phase:Phase;blob?:Blob;text?:string;error?:string;upload_attempted?:boolean};
type Dependencies={getStream:()=>Promise<MediaStream>;recorder:(stream:MediaStream,mime:string)=>MediaRecorder;supported:(mime:string)=>boolean;focus:typeof coordinator;setTimer:typeof setTimeout;clearTimer:typeof clearTimeout};
let sequence=0;
export class VoiceCapture {
 private token:{id:string;generation:number}|null=null;
 private stream:MediaStream|null=null;
 private recorder:MediaRecorder|null=null;
 private blob:Blob|null=null;
 private abort:AbortController|null=null;
 private timer:ReturnType<typeof setTimeout>|null=null;
 private epoch=0;
 private disposed=false;
 private readonly id=`voice-capture-${++sequence}`;
 private unsubscribe:()=>void;
 constructor(private changed:(state:VoiceState)=>void,private maxBytes:number,private dependencies:Dependencies={getStream:()=>navigator.mediaDevices.getUserMedia({audio:true}),recorder:(stream,mime)=>new MediaRecorder(stream,{mimeType:mime}),supported:mime=>typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported(mime),focus:coordinator,setTimer:setTimeout,clearTimer:clearTimeout}){
  this.unsubscribe=dependencies.focus.subscribe(state=>{if(this.token&&!state.currentOwner&&!state.suspendedOwners.has(this.token.id))this.cancel();});
 }
 private publish(state:VoiceState){if(!this.disposed)this.changed(state);}
 private release(){const token=this.token;this.token=null;if(token)this.dependencies.focus.release(token);}
 private stopTracks(){this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;}
 private clearRecording(){if(this.timer!==null)this.dependencies.clearTimer(this.timer);this.timer=null;const recorder=this.recorder;this.recorder=null;if(recorder&&recorder.state!=='inactive'){try{recorder.stop();}catch{}}this.stopTracks();this.release();}
 async record(){
  if(this.disposed)return;
  this.cancel();const epoch=this.epoch;
  const mime=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus'].find(this.dependencies.supported);
  if(!mime){this.publish({phase:'error',error:'Audio recording is unavailable in this runtime. Use text input.'});return;}
  this.token=this.dependencies.focus.acquire({type:'microphone',id:this.id,replaceEqual:true,onPreempt:()=>this.cancel()});
  this.publish({phase:'requesting'});
  try{
   const stream=await this.dependencies.getStream();
   if(this.disposed||epoch!==this.epoch){stream.getTracks().forEach(track=>track.stop());return;}
   this.stream=stream;const recorder=this.dependencies.recorder(stream,mime);this.recorder=recorder;const chunks:Blob[]=[];let size=0;
   recorder.ondataavailable=event=>{
    if(this.recorder!==recorder||epoch!==this.epoch||!event.data.size)return;
    size+=event.data.size;
    if(size>this.maxBytes){this.cancel();this.publish({phase:'error',error:'Recording exceeded the upload limit. Make a shorter recording.'});return;}
    chunks.push(event.data);
   };
   recorder.onerror=()=>{if(this.recorder===recorder){this.cancel();this.publish({phase:'error',error:'Unable to record audio. Use text input.'});}};
   recorder.onstop=()=>{
    if(this.recorder!==recorder||epoch!==this.epoch||this.disposed)return;
    this.recorder=null;if(this.timer!==null)this.dependencies.clearTimer(this.timer);this.timer=null;this.stopTracks();this.release();
    this.blob=new Blob(chunks,{type:mime});
    if(!this.blob.size){this.blob=null;this.publish({phase:'error',error:'The recording was empty. Try again or use text input.'});return;}
    this.publish({phase:'recorded',blob:this.blob});
   };
   recorder.start(250);this.publish({phase:'recording'});this.timer=this.dependencies.setTimer(()=>this.stop(),60000);
  }catch{if(epoch===this.epoch&&!this.disposed){this.clearRecording();this.publish({phase:'error',error:'Microphone access failed. You can continue with text input.'});}}
 }
 stop(){if(this.recorder?.state==='recording'){this.publish({phase:'stopping'});this.recorder.stop();}}
 async transcribe(send:(blob:Blob,signal:AbortSignal)=>Promise<string>){
  if(this.disposed||!this.blob||this.abort)return;
  const blob=this.blob,epoch=this.epoch,controller=new AbortController();this.abort=controller;this.publish({phase:'transcribing',blob,upload_attempted:true});
  try{const text=await send(blob,controller.signal);if(!this.disposed&&epoch===this.epoch&&!controller.signal.aborted)this.publish({phase:'review',text,blob,upload_attempted:true});}
  catch{if(!this.disposed&&epoch===this.epoch&&!controller.signal.aborted)this.publish({phase:'recorded',blob,upload_attempted:true,error:'Transcription failed. You can explicitly retry, record again or use text input.'});}
  finally{if(this.abort===controller)this.abort=null;}
 }
 cancel(){this.epoch++;this.abort?.abort();this.abort=null;this.blob=null;this.clearRecording();this.publish({phase:'idle'});}
 dispose(){if(this.disposed)return;this.disposed=true;this.unsubscribe();this.cancel();}
}
