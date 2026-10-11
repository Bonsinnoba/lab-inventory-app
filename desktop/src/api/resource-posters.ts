import {localBackend} from './local-backend';
import {captureAccountSession,isAccountSessionCurrent,captureServerRequest,isServerRequestCurrent,getToken} from './auth';
import {apiFetch,apiUrl} from './http';
import {isTauriRuntime} from '../lib/runtime';
import type {Resource} from './resources';

export function hasVideoPoster(r:Resource){return r.file_type==='video'||!!r.local_media_filename;}
export function serverPosterUrl(r:Resource){
  // Never attach the token to a resource-provided external URL.
  const token=getToken();return apiUrl(`/resources/${encodeURIComponent(r.id)}/thumbnail${token?'?access_token='+encodeURIComponent(token):''}`);
}
export async function readResourcePoster(r:Resource):Promise<Blob|null>{
  const session=captureAccountSession();if(!session||!hasVideoPoster(r))return null;
  const bytes=await localBackend.invoke<number[]|null>('read_local_resource_poster',{expectedAccountId:session.accountId,resourceId:r.id,revision:r.updated_at||r.created_at});
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading preview');
  return bytes?new Blob([new Uint8Array(bytes)],{type:'image/jpeg'}):null;
}
// Derived poster replication is separate from metadata/outbox success. Failure
// preserves the cached image and never hides resources or blocks authored work.
let pulling=false;
export async function pullResourcePosters(rows:Resource[]):Promise<void>{
  if(!isTauriRuntime()||pulling)return;
  const token=getToken();if(!token||token.startsWith('local:'))return;
  pulling=true;
  try{
    const context=await captureServerRequest(token);
    if(!context.accountId||!context.nativeSessionToken)return;
    for(const r of rows.filter(hasVideoPoster)){
      if(!isServerRequestCurrent(context))return;
      try{
        if(await readResourcePoster(r))continue;
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);
        try{
          const response=await apiFetch(`/resources/${encodeURIComponent(r.id)}/thumbnail`,{signal:controller.signal,cache:'no-store'});
          if(!response.ok||!response.headers.get('content-type')?.startsWith('image/jpeg'))continue;
          if(Number(response.headers.get('content-length'))>1048576)continue;
          const reader=response.body?.getReader();if(!reader)continue;
          const chunks:Uint8Array[]= [];let size=0;
          try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576)throw new Error('Preview too large');chunks.push(value);}}
          finally{await reader.cancel().catch(()=>{});}
          const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
          if(!isServerRequestCurrent(context))return;
          await localBackend.invoke('cache_local_resource_poster',{expectedAccountId:context.accountId,expectedSessionToken:context.nativeSessionToken,resourceId:r.id,revision:r.updated_at||r.created_at,bytes:Array.from(bytes)});
          if(isServerRequestCurrent(context))window.dispatchEvent(new Event('labos-posters-updated'));
        }finally{clearTimeout(timeout);}
      }catch{/* Retry missing posters on the next metadata synchronization. */}
    }
  }finally{pulling=false;}
}
