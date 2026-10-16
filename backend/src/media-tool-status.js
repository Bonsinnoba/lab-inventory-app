import { execFile } from 'node:child_process';

// Diagnostic probes are bounded independently from actual download processes.
export function probeMediaTool(command,args){
  return new Promise((resolve,reject)=>execFile(command,args,{windowsHide:true,timeout:2500,killSignal:'SIGKILL',maxBuffer:128*1024},error=>error?reject(error):resolve()));
}
export function createMediaToolInspector({commands,production,probe=probeMediaTool,now=Date.now,ttlMs=60000}){
  let cached=null,checkedAt=0,pending=null;
  return async()=>{
    const at=now();
    if(cached&&at>=checkedAt&&at-checkedAt<ttlMs)return cached;
    if(pending)return pending;
    pending=(async()=>{
      const entries=await Promise.all(Object.entries(commands).map(async([name,{path,args}])=>{
        try{await probe(path,args);return[name,{path,available:true}];}
        catch(error){return[name,{path,available:false,error:String(error?.message||'Unavailable').slice(0,500)}];}
      }));
      checkedAt=now();cached={...Object.fromEntries(entries),production,checked_at:new Date(checkedAt).toISOString()};return cached;
    })();
    try{return await pending;}finally{pending=null;}
  };
}
