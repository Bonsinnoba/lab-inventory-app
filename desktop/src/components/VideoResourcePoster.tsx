import {useEffect,useState} from 'react';
import {Play} from 'lucide-react';
import type {Resource} from '../api/resources';
import {readResourcePoster,serverPosterUrl} from '../api/resource-posters';
import {captureAccountSession,isAccountSessionCurrent} from '../api/auth';
import {isTauriRuntime} from '../lib/runtime';

export function useVideoPoster(resource:Resource|null){
  const [url,setUrl]=useState<string>();
  const account=captureAccountSession();
  useEffect(()=>{
    let disposed=false,objectUrl:string|undefined,sequence=0;const session=captureAccountSession();setUrl(undefined);
    const load=async()=>{
      const request=++sequence;
      if(!resource||!session)return;
      try{
        const next=isTauriRuntime()?await readResourcePoster(resource):null;
        if(disposed||request!==sequence||!isAccountSessionCurrent(session))return;
        if(objectUrl)URL.revokeObjectURL(objectUrl);
        objectUrl=next?URL.createObjectURL(next):undefined;
        setUrl(isTauriRuntime()?objectUrl:serverPosterUrl(resource));
      }catch{if(!disposed&&request===sequence)setUrl(undefined);}
    };
    const clear=()=>{sequence++;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=undefined;setUrl(undefined);};
    void load();window.addEventListener('labos-posters-updated',load);
    window.addEventListener('labos:auth-expired',clear);window.addEventListener('labos-user-updated',clear);
    return()=>{disposed=true;window.removeEventListener('labos-posters-updated',load);window.removeEventListener('labos:auth-expired',clear);window.removeEventListener('labos-user-updated',clear);if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[resource?.id,resource?.updated_at,account?.accountId,account?.generation]);
  return url;
}
export default function VideoResourcePoster({resource}:{resource:Resource}){
  const url=useVideoPoster(resource);const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[url]);
  return <div className="relative w-full h-full flex items-center justify-center bg-surface-raised">
    {url&&!failed?<img src={url} alt={`${resource.name} video preview`} className="absolute inset-0 w-full h-full object-cover" onError={()=>setFailed(true)}/>:<span className="text-xs text-text-secondary px-3 text-center">Preview not available on this device yet</span>}
    {url&&!failed&&<span className="relative rounded-full bg-black/60 p-2 text-white"><Play size={24}/></span>}
  </div>;
}
