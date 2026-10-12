import {localBackend} from './local-backend';
import {captureServerRequest,isServerRequestCurrent,getToken,observeNativeAuthFailure} from './auth';
import {isTauriRuntime} from '../lib/runtime';
import {refreshLocalFileAccess} from './resource-uploads';
import type {Resource} from './resources';

let running=false;
// Background read replication is intentionally independent of authored outbox ACKs.
// Native code fetches from the configured server, validates authority and writes
// one bounded, verified chunk. Rotate through every resource before another round.
export async function pullResourceFiles(resources:Resource[]):Promise<void>{
  if(running||!isTauriRuntime())return;
  const token=getToken();if(!token||token.startsWith('local:'))return;
  running=true;
  try{
    const context=await captureServerRequest(token);
    if(!context.accountId||!context.nativeSessionToken)return;
    let pending=resources.filter(r=>r.kind==='file'||(r.kind==='link'&&!!r.local_media_filename));
    for(let round=0;round<8&&pending.length;round++){
      const next:Resource[]=[];
      for(const resource of pending){
        if(!isServerRequestCurrent(context))return;
        try{
          const result=await localBackend.invoke<{state:string}>('replicate_local_resource',{
            expectedAccountId:context.accountId,expectedSessionToken:context.nativeSessionToken,
            serverToken:token,resourceId:resource.id,
          });
          if(!isServerRequestCurrent(context))return;
          if(result.state==='copying')next.push(resource);
          if(result.state==='ready'){
            await refreshLocalFileAccess();
            if(isServerRequestCurrent(context))window.dispatchEvent(new Event('labos:manual-sync-complete'));
          }
        }catch(error){
          await observeNativeAuthFailure(error,context);
          // Native status retains failures; retry on the next metadata sync,
          // not in a hot loop and never through an alternate HTTP write.
        }
      }
      pending=next;
    }
  }finally{running=false;}
}
