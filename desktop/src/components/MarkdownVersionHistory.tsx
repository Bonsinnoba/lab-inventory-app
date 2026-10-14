import {useState} from 'react';
import {listMarkdownSavedVersions,readMarkdownSavedVersion,type MarkdownSavedVersion} from '../api/resources';

export default function MarkdownVersionHistory({resourceId,onUse,disabled}:{resourceId:string;onUse:(text:string)=>void;disabled:boolean}){
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [versions,setVersions]=useState<MarkdownSavedVersion[]>([]);
  const [preview,setPreview]=useState<{version:MarkdownSavedVersion;text:string}|null>(null);
  const load=async()=>{
    setOpen(true);setBusy(true);setError('');setPreview(null);
    try{setVersions(await listMarkdownSavedVersions(resourceId));}
    catch(e){setError(e instanceof Error?e.message:'Unable to read saved versions');setVersions([]);}
    finally{setBusy(false);}
  };
  const inspect=async(version:MarkdownSavedVersion)=>{
    setBusy(true);setError('');setPreview(null);
    try{setPreview({version,text:await readMarkdownSavedVersion(resourceId,version.change_id)});}
    catch(e){setError(e instanceof Error?e.message:'Unable to read this version');}
    finally{setBusy(false);}
  };
  const exportVersion=async()=>{
    if(!preview)return;setBusy(true);setError('');
    try{
      // Reauthorize immediately before export; do not export a stale preview
      // after an account switch or observed revocation.
      const text=await readMarkdownSavedVersion(resourceId,preview.version.change_id);
      const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download=`LabOS-saved-${preview.version.change_id}.md`;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError(e instanceof Error?e.message:'Unable to export saved version');}
    finally{setBusy(false);}
  };
  const useVersion=async()=>{
    if(!preview||!window.confirm('Replace the unsaved text in this editor with the selected saved version? This does not save or synchronize it.'))return;
    setBusy(true);setError('');
    try{onUse(await readMarkdownSavedVersion(resourceId,preview.version.change_id));setOpen(false);}
    catch(e){setError(e instanceof Error?e.message:'Unable to use saved version');}
    finally{setBusy(false);}
  };
  return <section className="border-b border-border bg-surface-raised px-4 py-2 text-xs">
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-secondary">Saved versions on this PC</span>
      <button disabled={busy||disabled} onClick={()=>open?setOpen(false):void load()} className="rounded px-2 py-1 text-accent hover:bg-surface disabled:opacity-40" aria-expanded={open}>{open?'Hide versions':'Review / export'}</button>
    </div>
    {open&&<div className="mt-2 max-h-72 overflow-auto">
      <p className="mb-2 text-text-secondary">Latest 100 local saves. Confirmed means accepted at that time—not necessarily the current server version. Discarded means its sync intent was retired; the file was kept.</p>
      {error&&<p role="alert" className="mb-2 text-status-danger">{error}</p>}
      {busy&&<p role="status" className="text-text-secondary">Reading saved files…</p>}
      {!busy&&!error&&!versions.length&&<p className="text-text-secondary">No saved editor versions on this PC yet.</p>}
      <div className="flex flex-wrap gap-2">{versions.map(v=><button key={v.change_id} disabled={busy||disabled} onClick={()=>void inspect(v)} className={`rounded border px-2 py-1 text-left disabled:opacity-40 ${preview?.version.change_id===v.change_id?'border-accent text-accent':'border-border text-text-secondary'}`}>
        {v.created_at} · {v.status} · {v.size_bytes.toLocaleString()} bytes · {v.change_id.slice(0,8)}
      </button>)}</div>
      {preview&&<div className="mt-3">
        <textarea readOnly value={preview.text} aria-label="Saved Markdown version preview" className="h-24 w-full rounded border border-border bg-bg p-2 font-mono text-text-primary"/>
        <div className="mt-2 flex gap-2">
          <button disabled={busy||disabled} onClick={()=>void exportVersion()} className="rounded border border-border px-3 py-1 text-text-primary disabled:opacity-40">Export .md</button>
          <button disabled={busy||disabled} onClick={()=>void useVersion()} className="rounded bg-accent px-3 py-1 text-bg disabled:opacity-40">Use in editor for review</button>
        </div>
        <p className="mt-2 text-text-secondary">Saving after review creates a new version with the normal permission and conflict checks. It does not force an overwrite.</p>
      </div>}
    </div>}
  </section>;
}
