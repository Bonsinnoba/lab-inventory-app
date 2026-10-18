import {useEffect,useState} from 'react';
import {Play} from 'lucide-react';
import type {Resource} from '../api/resources';
import {readResourcePoster,serverPosterUrl} from '../api/resource-posters';
import {captureAccountSession,isAccountSessionCurrent} from '../api/auth';
import {isTauriRuntime} from '../lib/runtime';

export function useVideoPoster(resource:Resource|null){
  const [preview,setPreview]=useState<{key:string;url:string|undefined}>();
  const account=captureAccountSession();
  const key=JSON.stringify([resource?.id,resource?.updated_at||resource?.created_at,account?.accountId,account?.generation]);
  useEffect(()=>{
    let disposed=false,objectUrl:string|undefined,sequence=0,previousBytes:Uint8Array|undefined;const session=captureAccountSession();
    const clear=()=>{sequence++;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=undefined;previousBytes=undefined;setPreview(undefined);};
    const load=async()=>{
      const request=++sequence;
      if(!resource||!session)return;
      try{
        const next=isTauriRuntime()?await readResourcePoster(resource):null;
        const bytes=next?new Uint8Array(await next.arrayBuffer()):undefined;
        if(disposed||request!==sequence||!isAccountSessionCurrent(session))return;
        // Sync revalidates previews, but identical bytes must keep the same img
        // and blob URL. Never reuse bytes across resource/revision/session keys.
        if(bytes&&previousBytes&&bytes.length===previousBytes.length&&bytes.every((value,index)=>value===previousBytes![index]))return;
        const oldUrl=objectUrl;
        previousBytes=bytes;
        objectUrl=next?URL.createObjectURL(next):undefined;
        setPreview({key,url:isTauriRuntime()?objectUrl:serverPosterUrl(resource)});
        if(oldUrl)URL.revokeObjectURL(oldUrl);
      }catch{if(!disposed&&request===sequence)clear();}
    };
    const userUpdated=()=>{if(!isAccountSessionCurrent(session))clear();else void load();};
    void load();window.addEventListener('labos-posters-updated',load);
    window.addEventListener('labos:auth-expired',clear);window.addEventListener('labos-user-updated',userUpdated);
    return()=>{disposed=true;window.removeEventListener('labos-posters-updated',load);window.removeEventListener('labos:auth-expired',clear);window.removeEventListener('labos-user-updated',userUpdated);if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[key]);
  // Do not expose the preceding resource/account's URL for the render before
  // effect cleanup. Blob URLs are revoked on replacement, revocation and unmount.
  return account&&isAccountSessionCurrent(account)&&preview?.key===key?preview.url:undefined;
}
export default function VideoResourcePoster({resource}:{resource:Resource}){
  const url=useVideoPoster(resource);const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[url]);
  return <div className="relative w-full h-full flex items-center justify-center bg-surface-raised">
    {url&&!failed?<img src={url} alt={`${resource.name} video preview`} className="absolute inset-0 w-full h-full object-cover" onError={()=>setFailed(true)}/>:<span className="text-xs text-text-secondary px-3 text-center">Preview not available on this device yet</span>}
    {url&&!failed&&<span className="relative rounded-full bg-black/60 p-2 text-white"><Play size={24}/></span>}
  </div>;
}
