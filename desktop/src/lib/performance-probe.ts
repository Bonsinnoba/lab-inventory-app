import {invoke} from '@tauri-apps/api/tauri';
import {isTauriRuntime} from './runtime';

// Native environment opt-in only. Metrics contain counts/durations, never keys,
// selectors, filenames, text, account IDs, recordings or network destinations.
export async function startPerformanceProbe():Promise<void>{
 if(!isTauriRuntime())return;
 try{if(!await invoke<boolean>('local_performance_probe',{sample:null}))return;}catch{return;}
 const started=performance.now(),interactions=new Map<number,number>();
 let inputs=0,longTasks=0,longMax=0,heartbeatMax=0,last=performance.now(),stopped=false,flushing=false;
 const observers:PerformanceObserver[]=[];
 const supported=typeof PerformanceObserver==='undefined'?[]:PerformanceObserver.supportedEntryTypes||[];
 const eventSupported=supported.includes('event'),longSupported=supported.includes('longtask');
 if(eventSupported){
  const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries()){
   const id=(entry as PerformanceEntry&{interactionId?:number}).interactionId;
   if(!id)continue;
   interactions.set(id,Math.max(interactions.get(id)||0,entry.duration));
   if(interactions.size>4096)interactions.delete(interactions.keys().next().value!);
  }});
  observer.observe({type:'event',buffered:false,durationThreshold:16} as PerformanceObserverInit);observers.push(observer);
 }
 if(longSupported){
  const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries()){longTasks++;longMax=Math.max(longMax,entry.duration);}});
  observer.observe({type:'longtask',buffered:false});observers.push(observer);
 }
 const input=()=>{inputs++;};window.addEventListener('pointerdown',input,true);window.addEventListener('keydown',input,true);
 const heartbeat=window.setInterval(()=>{const now=performance.now();if(document.visibilityState==='visible')heartbeatMax=Math.max(heartbeatMax,Math.max(0,now-last-100));last=now;},100);
 const stop=()=>{if(stopped)return;stopped=true;window.clearInterval(heartbeat);window.clearInterval(flush);observers.forEach(observer=>observer.disconnect());window.removeEventListener('pointerdown',input,true);window.removeEventListener('keydown',input,true);window.removeEventListener('beforeunload',stop);};
 const flush=window.setInterval(async()=>{
  if(flushing||stopped)return;flushing=true;
  try{
   const events=[...interactions.values()].sort((a,b)=>a-b);
   const enabled=await invoke<boolean>('local_performance_probe',{sample:{elapsed_ms:performance.now()-started,input_count:inputs,observed_interactions:events.length,event_p95_ms:events.length?events[Math.ceil(events.length*.95)-1]:0,event_max_ms:events[events.length-1]||0,long_tasks:longTasks,long_task_max_ms:longMax,heartbeat_max_ms:heartbeatMax,event_supported:eventSupported,long_task_supported:longSupported}});
   if(!enabled)stop();
  }catch{stop();}finally{flushing=false;}
 },5000);
 window.addEventListener('beforeunload',stop);
}
