import {useEffect,useState} from 'react';
import {Film} from 'lucide-react';
import type {Resource} from '../api/resources';
import {getLocalThumbnailUrl,type DownloadJob} from '../api/mediaDownloads';
import {isTauriRuntime} from '../lib/runtime';
import {useVideoPoster} from './VideoResourcePoster';

export default function DownloadResourcePreview({job,resource}:{job:Pick<DownloadJob,'resource_id'|'thumbnail_url'>;resource?:Resource}){
  const desktop=isTauriRuntime();
  const localPoster=useVideoPoster(desktop?(resource??null):null);
  // Desktop must never fall through to the server or an external thumbnail URL.
  const src=desktop?localPoster:job.thumbnail_url?.startsWith('/api/')?getLocalThumbnailUrl(job.resource_id):job.thumbnail_url;
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[src]);
  return <div className="w-24 h-14 rounded-sm overflow-hidden bg-surface-raised shrink-0" title={src&&!failed?'Resource preview':'Preview not available'}>
    {src&&!failed?<img src={src} className="w-full h-full object-cover" alt="" onError={()=>setFailed(true)}/>:<Film className="w-full h-full p-5 text-text-secondary"/>}
  </div>;
}
