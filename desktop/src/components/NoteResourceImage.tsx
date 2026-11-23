import {useEffect,useState} from 'react';
import {NodeViewWrapper,type NodeViewProps} from '@tiptap/react';
import {getResource,getResourceDownloadUrl} from '../api/resources';
import {refreshLocalFileAccess} from '../api/resource-uploads';
import {captureAccountSession,isAccountSessionCurrent} from '../api/auth';
import {isTauriRuntime} from '../lib/runtime';

/** Only the stable ID is in the note. Resolve current authorized file access
 * on each mount; never persist tokens, capabilities or machine paths. */
export default function NoteResourceImage({node}:NodeViewProps){
 const id=String(node.attrs.resourceId||''),alt=String(node.attrs.alt||'Pasted image');
 const [preview,setPreview]=useState<{id:string;url:string;message:string}>({id:'',url:'',message:''});
 const [retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;const owner=captureAccountSession();setPreview({id,url:'',message:'Loading image…'});
  void(async()=>{try{
   if(!/^[\w-]{1,100}$/.test(id))throw Error('Invalid image reference');
   const resource=await getResource(id);
   if(!active||!isAccountSessionCurrent(owner))return;
   if(resource.kind!=='file'||resource.file_type!=='image')throw Error('This resource is not an image');
   let url=getResourceDownloadUrl(id);
   if(!url&&isTauriRuntime()){await refreshLocalFileAccess({reuseInFlight:true});url=getResourceDownloadUrl(id);}
   if(active&&isAccountSessionCurrent(owner))setPreview({id,url,message:url?'':'Image not available on this PC yet. Reconnect to copy it, then retry.'});
  }catch(error){if(active&&isAccountSessionCurrent(owner))setPreview({id,url:'',message:error instanceof Error?error.message:'Image unavailable'});}})();
  return()=>{active=false;};
 },[id,retry]);
 const current=preview.id===id?preview:null;
 return <NodeViewWrapper as="figure" contentEditable={false} className="note-resource-image" data-note-resource-image={id}>
  {current?.url?<img src={current.url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={()=>setPreview({id,url:'',message:'Image could not be read. Retry after synchronizing.'})}/>:<div role="status">{current?.message||'Loading image…'} <button type="button" onClick={()=>setRetry(n=>n+1)}>Retry image</button></div>}
  <figcaption>{alt}</figcaption>
 </NodeViewWrapper>;
}
