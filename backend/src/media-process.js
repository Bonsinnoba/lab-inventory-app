import {spawn} from 'node:child_process';

// Keep output bounded and progress callbacks serial/coalesced; large or noisy
// downloads must not accumulate output or thousands of pending SQL callbacks.
export function runMediaProcess(command,args,{jobId,onProgress,processes,parseProgress,terminate,timeoutMs=0,spawnProcess=spawn}={}){
  return new Promise((resolve,reject)=>{
    const child=spawnProcess(command,args,{windowsHide:true,detached:process.platform!=='win32'});
    if(jobId)processes.set(jobId,child);
    let stdout='',stderr='',outLine='',errLine='',settled=false,deadline=null,timedOut=false,latest=null,reporting=false;
    const report=async()=>{
      if(reporting)return;reporting=true;
      try{while(latest){const value=latest;latest=null;try{await onProgress?.(value);}catch{/* A progress observer cannot reject the subprocess result. */}}}
      finally{reporting=false;}
    };
    const progress=line=>{const value=parseProgress?.(line);if(value){latest=value;void report();}};
    const finish=(fn,value)=>{
      if(settled)return;settled=true;if(deadline)clearTimeout(deadline);
      if(jobId&&processes.get(jobId)===child)processes.delete(jobId);
      fn(value);
    };
    const consume=(chunk,isOut)=>{
      const text=chunk.toString();
      if(isOut)stdout=(stdout+text).slice(-65536);else stderr=(stderr+text).slice(-65536);
      const lines=((isOut?outLine:errLine)+text).split(/\r?\n|\r/),remainder=(lines.pop()||'').slice(-8192);
      if(isOut)outLine=remainder;else errLine=remainder;
      for(const line of lines)progress(line);
      if(/download:/i.test(remainder))progress(remainder);
    };
    child.stdout.on('data',chunk=>consume(chunk,true));child.stderr.on('data',chunk=>consume(chunk,false));
    child.on('error',error=>finish(reject,error));
    child.on('close',code=>{
      progress(outLine);progress(errLine);
      if(timedOut)finish(reject,new Error('Media thumbnail extraction timed out'));
      else if(code===0)finish(resolve,{stdout,stderr});
      else finish(reject,Object.assign(new Error((stderr.trim().split(/\r?\n/).pop()||stdout.trim().split(/\r?\n/).pop()||`Media process exited with code ${code}`).slice(-2000)),{code}));
    });
    if(timeoutMs>0){deadline=setTimeout(()=>{timedOut=true;terminate(child,true);},timeoutMs);deadline.unref?.();}
  });
}
