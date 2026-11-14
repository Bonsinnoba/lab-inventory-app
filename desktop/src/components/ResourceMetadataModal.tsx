import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import {captureAccountSession,isAccountSessionCurrent} from '../api/auth';
import {isLocalResourceRuntime,updateResourceMetadata,type Resource} from '../api/resources';

const categories=['general','datasheet','manual','schematic','research','tutorial','reference','specification','image','cad','report','video','other'];
export default function ResourceMetadataModal({resource,onClose,onSaved}:{resource:Resource;onClose:()=>void;onSaved:(resource:Resource)=>void}){
 const [owner]=useState(captureAccountSession);
 const [reviewed]=useState(()=>({name:resource.name,updated_at:resource.updated_at,category:resource.category||'general',description:resource.description||'',tags:[...(resource.tags||[])]}));
 const [category,setCategory]=useState(reviewed.category),[description,setDescription]=useState(reviewed.description),[tags,setTags]=useState(reviewed.tags.join(', '));
 const [name,setName]=useState(reviewed.name);
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const root=useRef<HTMLDivElement>(null),busy=useRef(false);
 const dirty=name!==reviewed.name||category!==reviewed.category||description!==reviewed.description||tags!==reviewed.tags.join(', ');
 const close=()=>{if(!busy.current&&(!dirty||window.confirm('Discard unsaved resource details?')))onClose();};
 const closeRef=useRef(close);closeRef.current=close;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;root.current?.querySelector<HTMLElement>('select')?.focus();
  const keyboard=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();closeRef.current();}
   if(event.key==='Tab'){
    const nodes=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled),textarea:not(:disabled)')||[]);
    const first=nodes[0],last=nodes.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
   }
  };document.addEventListener('keydown',keyboard);return()=>{document.removeEventListener('keydown',keyboard);previous?.focus();};
 },[]);
 const save=async()=>{
  if(busy.current)return;
  const session=captureAccountSession();
  if(!owner||!session||session.accountId!==owner.accountId){setError('Sign in to the account that opened these details. Your draft remains here.');return;}
  if(name.trim()!==reviewed.name&&(!name.trim()||Array.from(name.trim()).length>200)){setError('Name must contain 1 to 200 characters.');return;}
  const parsed=tags.split(',').map(tag=>tag.trim()).filter(Boolean);
  if(parsed.length>30||parsed.some(tag=>Array.from(tag).length>256)){setError('Use at most 30 tags, each up to 256 characters.');return;}
  if(Array.from(description).length>5000){setError('Description must be 5,000 characters or fewer.');return;}
  busy.current=true;setSaving(true);setError('');
  // Preserve untouched metadata exactly (including historical tags containing
  // commas); editing the description must not silently rewrite the tag array.
  const fields={...(name.trim()!==reviewed.name?{name:name.trim()}:{}),...(category!==reviewed.category?{category}:{}),...(description!==reviewed.description?{description}:{}),...(tags!==reviewed.tags.join(', ')?{tags:parsed}:{})};
  try{const updated=await updateResourceMetadata(resource.id,fields,reviewed,session);if(isAccountSessionCurrent(session))onSaved(updated);}
  catch(e){setError(e instanceof Error?e.message:'Unable to save resource details');}
  finally{busy.current=false;setSaving(false);}
 };
 const control='mt-1 block w-full rounded border border-border bg-surface-raised p-2 text-sm';
 return createPortal(<div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onMouseDown={event=>{if(event.target===event.currentTarget)close();}}>
  <div ref={root} role="dialog" aria-modal="true" aria-labelledby="resource-details-title" className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-border bg-surface shadow-2xl">
   <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3"><h2 id="resource-details-title" className="font-semibold">Edit resource details</h2><button type="button" onClick={close} disabled={saving} aria-label="Close resource details" className="rounded p-1 hover:bg-surface-raised"><X size={18}/></button></header>
   <div className="space-y-4 overflow-y-auto p-5"><p className="break-words text-sm font-medium">{resource.name}</p>
    <fieldset disabled={saving} className="space-y-4">
     <label className="block text-sm">Name<input value={name} onChange={e=>setName(e.target.value)} className={control}/></label>
     <label className="block text-sm">Category<select value={category} onChange={e=>setCategory(e.target.value)} className={control}>{categories.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
     <label className="block text-sm">Description<textarea value={description} onChange={e=>setDescription(e.target.value)} rows={5} className={control}/><span className="text-xs text-text-secondary">{Array.from(description).length}/5,000 characters</span></label>
     <label className="block text-sm">Tags<input value={tags} onChange={e=>setTags(e.target.value)} placeholder="Comma-separated tags" className={control}/></label>
    </fieldset>
    <p className="text-xs text-text-secondary">{isLocalResourceRuntime()?'Details are saved on this PC and queued for synchronization.':'Details are confirmed by the server.'} File contents and attachments are managed separately.</p>
    {error&&<p role="alert" className="text-sm text-status-danger">{error}</p>}
   </div>
   <footer className="flex justify-end gap-2 border-t border-border px-5 py-3"><button type="button" onClick={close} disabled={saving} className="rounded border border-border px-3 py-2 text-sm">Cancel</button><button type="button" onClick={()=>void save()} disabled={saving||!dirty} className="rounded bg-accent px-3 py-2 text-sm text-bg disabled:opacity-50">{saving?'Saving…':'Save details'}</button></footer>
  </div>
 </div>,document.body);
}
