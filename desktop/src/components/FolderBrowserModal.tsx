import {useEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {X,Folder,Upload} from 'lucide-react';
import {getResourceManifest,getResource,uploadFolderFiles,isLocalResourceRuntime,type ResourceManifest,type Resource} from '../api/resources';
import {captureAccountSession,isAccountSessionCurrent,getCurrentPermissions} from '../api/auth';
import {filesFromDrop,filesFromPicker,type SelectedUpload} from '../api/resource-upload-selection';
import {invalidateResourceAttachments} from '../api/resource-attachment-presentation';
import {folderLocation} from '../lib/folderNavigation';
import FolderContents from './FolderContents';
import CreateResourceFolderModal from './CreateResourceFolderModal';
import {folderDestination} from '../lib/folderManifest';
import ResourceViewerModal from './ResourceViewerModal';
import {folderViewerResources} from '../lib/folderViewerResources';

export default function FolderBrowserModal({folderResourceId,onClose,onOpenResource}:{folderResourceId:string;onClose:()=>void;onOpenResource?:(resource:Resource,siblings:Resource[])=>void}){
 const [owner]=useState(captureAccountSession),qc=useQueryClient();
 const [manifest,setManifest]=useState<ResourceManifest|null>(null),[folderResource,setFolderResource]=useState<Resource|null>(null),[error,setError]=useState<string|null>(null);
 const [openingFile,setOpeningFile]=useState<Resource|null>(null),[opening,setOpening]=useState<string|null>(null),[directory,setDirectory]=useState(''),[subfolder,setSubfolder]=useState('');
 const [canUpload,setCanUpload]=useState(false),[progress,setProgress]=useState<number|null>(null),[notice,setNotice]=useState('');
 const [creatingFolder,setCreatingFolder]=useState(false);
 const fileInput=useRef<HTMLInputElement>(null),folderInput=useRef<HTMLInputElement>(null),busy=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{let active=true;setManifest(null);setError(null);setDirectory('');
  Promise.all([getResourceManifest(folderResourceId),getResource(folderResourceId)]).then(([manifest,folder])=>{if(active){setManifest(manifest);setFolderResource(folder);}}).catch(()=>{if(active)setError('Could not load this folder.');});
  getCurrentPermissions().then(permissions=>{if(active)setCanUpload(isLocalResourceRuntime()&&permissions.includes('resources.create'));}).catch(()=>{if(active)setCanUpload(false);});
  return()=>{active=false;};
 },[folderResourceId]);
 const upload=async(entries:SelectedUpload[])=>{
  if(busy.current||!canUpload||!entries.length)return;
  const session=captureAccountSession();
  if(!owner||!session||session.accountId!==owner.accountId){setError('Sign in to the account that opened this folder before adding files.');return;}
  busy.current=true;setProgress(0);setError(null);setNotice('');
  let committed=false;
  try{
   const suffix=folderLocation(subfolder.trim()),prefix=[directory,suffix].filter(Boolean).join('/');
   const destination=folderDestination(folderResourceId,manifest?.files||[],prefix);
   const paths=entries.map(entry=>[destination.relativeDirectory,entry.path].filter(Boolean).join('/'));
   await uploadFolderFiles(destination.folderId,entries.map(entry=>entry.file),paths,n=>{if(mounted.current)setProgress(n);});
   committed=true;if(!isAccountSessionCurrent(session))return;
   if(mounted.current){setSubfolder('');setNotice(`${entries.length} files saved on this PC and queued for sync.`);}
   await invalidateResourceAttachments(qc);
   if(!isAccountSessionCurrent(session))return;
   const refreshed=await getResourceManifest(folderResourceId);
   if(mounted.current&&isAccountSessionCurrent(session))setManifest(refreshed);
  }catch(e){if(mounted.current)setError(committed?'Files were saved, but the folder list could not refresh. Reopen the folder to view them.':e instanceof Error?e.message:'Could not add files to this folder.');}
  finally{busy.current=false;if(mounted.current)setProgress(null);}
 };
 const pick=(files:FileList|null)=>{if(files)try{void upload(filesFromPicker(files));}catch(e){setError(e instanceof Error?e.message:'Could not select files.');}};
 const open=async(id:string)=>{if(opening||busy.current)return;setOpening(id);setError(null);try{const resource=await getResource(id);if(mounted.current){if(onOpenResource)onOpenResource(resource,folderViewerResources(manifest?.files||[],directory,resource));else setOpeningFile(resource);}}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Could not open that file.');}finally{if(mounted.current)setOpening(null);}};
 return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy.current)onClose();}}>
  <div role="dialog" aria-modal="true" aria-labelledby="folder-browser-title" className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-surface">
   <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3"><h3 id="folder-browser-title" className="flex min-w-0 items-center gap-2 font-semibold"><Folder size={18}/><span className="truncate">{manifest?.folder||'Folder'}</span></h3><button type="button" disabled={progress!==null} onClick={onClose} aria-label="Close folder" className="rounded p-1 hover:bg-surface-raised"><X size={18}/></button></header>
   {canUpload&&<div className="space-y-2 border-b border-border p-4"><div className="flex flex-wrap gap-2"><button type="button" disabled={progress!==null} onClick={()=>setCreatingFolder(true)} className="rounded border border-border px-3 py-2 text-sm">New folder here</button><button type="button" disabled={progress!==null} onClick={()=>fileInput.current?.click()} className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm"><Upload size={15}/>Add files here</button><button type="button" disabled={progress!==null} onClick={()=>folderInput.current?.click()} className="rounded border border-border px-3 py-2 text-sm">Import subfolder</button></div><label className="block text-xs text-text-secondary">New subfolder path (optional)<input value={subfolder} disabled={progress!==null} onChange={e=>setSubfolder(e.target.value)} placeholder="e.g. references/circuits" className="mt-1 w-full rounded border border-border bg-surface-raised p-2 text-sm"/></label><p className="text-xs text-text-secondary">Adds files under the current folder path. Existing files are preserved; matching paths require an explicit replacement. Empty folders are not imported.</p><input hidden ref={fileInput} type="file" multiple onChange={e=>{pick(e.target.files);e.target.value='';}}/><input hidden ref={folderInput} type="file" multiple {...({webkitdirectory:'',directory:''} as any)} onChange={e=>{pick(e.target.files);e.target.value='';}}/></div>}
   <div className="min-h-0 flex-1 overflow-auto p-4" onDragOver={e=>{if(canUpload){e.preventDefault();e.dataTransfer.dropEffect='copy';}}} onDrop={e=>{if(!canUpload)return;e.preventDefault();void filesFromDrop(e.dataTransfer).then(upload).catch(e=>setError(e instanceof Error?e.message:'Unable to read dropped files.'));}}>
    {progress!==null&&<p role="status" className="mb-3 text-sm">Saving files on this PC: {Math.round(progress)}%</p>}{notice&&<p role="status" className="mb-3 text-sm text-status-success">{notice}</p>}{error&&<p role="alert" className="mb-3 text-sm text-status-danger">{error}</p>}
    {!manifest&&!error&&<p className="py-6 text-center text-sm text-text-secondary">Loading folder…</p>}{manifest&&<FolderContents files={manifest.files} directory={directory} onNavigate={path=>{setDirectory(path);setNotice('');}} onOpen={id=>void open(id)} opening={opening} disabled={progress!==null||!!opening}/>}
   </div>
  </div>
{creatingFolder&&<CreateResourceFolderModal parentId={folderDestination(folderResourceId,manifest?.files||[],directory).folderId} directory={folderDestination(folderResourceId,manifest?.files||[],directory).relativeDirectory} onClose={()=>setCreatingFolder(false)} onCreated={async()=>{const session=captureAccountSession();await invalidateResourceAttachments(qc);if(!owner||!session||session.accountId!==owner.accountId||!isAccountSessionCurrent(session))return;const refreshed=await getResourceManifest(folderResourceId);if(mounted.current&&isAccountSessionCurrent(session)){setManifest(refreshed);setCreatingFolder(false);setNotice('Folder saved on this PC; pending sync.');}}}/>}  {openingFile&&<ResourceViewerModal resource={openingFile} resources={folderViewerResources(manifest?.files||[],directory,openingFile)} navigationIds={folderViewerResources(manifest?.files||[],directory,openingFile).map(item=>item.id)} outerResources={folderResource?[folderResource]:[]} folderOriginId={folderResourceId} onClose={()=>setOpeningFile(null)}/>}
 </div>;
}
