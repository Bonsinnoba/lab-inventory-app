import {useState} from 'react';
import {createFolder,type Resource} from '../api/resources';
import {captureAccountSession,isAccountSessionCurrent} from '../api/auth';
import {folderLocation} from '../lib/folderNavigation';

export default function CreateResourceFolderModal({parentId,directory='',onClose,onCreated}:{parentId?:string;directory?:string;onClose:()=>void;onCreated:(folder:Resource)=>void|Promise<void>}){
 const [owner]=useState(captureAccountSession),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(event:React.FormEvent){
  event.preventDefault();if(busy)return;
  const session=captureAccountSession();
  if(!owner||!session||session.accountId!==owner.accountId){setError('Sign in to the account that opened this draft before saving.');return;}
  const title=name.trim();if(!title||title.length>200||/[\\/:\x00-\x1f\x7f]/.test(title)||['.','..'].includes(title)){setError('Use a folder name of 1 to 200 characters without path separators.');return;}
  setBusy(true);setError('');let committed=false;
  try{
   const path=parentId?folderLocation([directory,title].filter(Boolean).join('/')):undefined;
   const folder=await createFolder(title,parentId?{parent_resource_id:parentId}:{},path);committed=true;
   if(!isAccountSessionCurrent(session))return;
   await onCreated(folder);
  }catch(e){setError(committed?'The folder was saved, but its list could not refresh. Reopen the folder to see it.':e instanceof Error?e.message:'Could not create the folder.');}
  finally{setBusy(false);}
 }
 return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"><form onSubmit={e=>void save(e)} role="dialog" aria-modal="true" aria-labelledby="create-folder-title" className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-2xl">
  <h3 id="create-folder-title" className="text-lg font-semibold">New folder</h3><p className="mt-1 text-sm text-text-secondary">Saved on this PC and queued for synchronization. Folders can be empty.</p>
  <label className="mt-4 block text-sm">Folder name<input autoFocus value={name} onChange={e=>setName(e.target.value)} disabled={busy} maxLength={200} className="mt-1 block w-full rounded border border-border bg-surface-raised px-3 py-2"/></label>
  {error&&<p role="alert" className="mt-3 text-sm text-status-danger">{error}</p>}
  <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded border border-border px-3 py-2 text-sm">Cancel</button><button type="submit" disabled={busy||!name.trim()} className="rounded bg-accent px-3 py-2 text-sm text-bg disabled:opacity-50">{busy?'Saving…':'Create folder'}</button></div>
 </form></div>;
}
