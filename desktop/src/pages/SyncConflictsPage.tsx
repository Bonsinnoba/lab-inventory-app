import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, GitMerge, CheckCircle2 } from 'lucide-react';
import { listSyncConflicts, resolveSyncConflict, syncPendingChanges } from '../api/sync';
import { useToast } from '../contexts/ToastContext';

type Conflict = { change_id:string; entity_type:string; entity_id?:string|null; operation:string; payload:unknown; error_code:string; error_message:string; created_at:string };

export default function SyncConflictsPage(){
  const {showToast}=useToast();
  const [conflicts,setConflicts]=useState<Conflict[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  async function refresh(){
    setLoading(true);
    try{setConflicts(await listSyncConflicts() as Conflict[]);setError(null)}
    catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setLoading(false)}
  }
  useEffect(()=>{void refresh()},[]);
  async function resolve(change:Conflict,resolution:'keep_local'|'accept_server'){
    const explanation=resolution==='accept_server'?'Discard this pending local change and retrieve the server version?':'Retry the local change? The server may reject it again.';
    if(!window.confirm(explanation))return;
    setBusy(change.change_id);
    try{
      await resolveSyncConflict(change.change_id,resolution);
      if(resolution==='keep_local')await syncPendingChanges(true);
      await refresh();
      showToast(resolution==='accept_server'?'Server version selected; synchronize to refresh local data.':'Local change queued for retry.');
    }catch(e){showToast(e instanceof Error?e.message:'Unable to resolve conflict','error')}
    finally{setBusy(null)}
  }
  return <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2"><GitMerge size={24}/> Sync conflicts</h1><p className="text-sm text-text-secondary mt-1">Review offline changes rejected by the server before choosing a resolution.</p></div><button className="px-3 py-2 border border-border rounded-lg text-sm flex items-center gap-2" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={16}/> Refresh</button></div>
    {error&&<div role="alert" className="text-status-danger">{error}</div>}
    {loading?<p className="text-text-secondary">Loading conflicts…</p>:conflicts.length===0?<div className="border border-border rounded-xl p-8 text-center"><CheckCircle2 className="mx-auto mb-2 text-status-success"/><p>No unresolved sync conflicts.</p></div>:<div className="space-y-3">{conflicts.map(c=><section key={c.change_id} className="border border-border rounded-xl p-4 bg-surface space-y-3"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold capitalize">{c.entity_type.replaceAll('_',' ')} · {c.operation}</h2><p className="text-xs text-text-secondary break-all">{c.entity_id||c.change_id}</p></div><AlertTriangle className="text-status-warning shrink-0" size={20}/></div><p className="text-sm">{c.error_message}</p><p className="text-xs text-text-secondary">Code: {c.error_code} · Recorded: {c.created_at}</p><details className="text-sm"><summary className="cursor-pointer text-text-secondary">Inspect pending local change</summary><pre className="overflow-auto whitespace-pre-wrap break-all p-3 bg-surface-raised rounded-lg mt-2 text-xs">{JSON.stringify(c.payload,null,2)}</pre></details><div className="flex flex-wrap gap-2"><button disabled={busy!==null} onClick={()=>void resolve(c,'keep_local')} className="px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-50">Retry local change</button><button disabled={busy!==null} onClick={()=>void resolve(c,'accept_server')} className="px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-50">Accept server version</button></div></section>)}</div>}
    <p className="text-xs text-text-secondary">For stock quantities, inspect movement history before resolving. Accepting the server version discards the pending local operation; it does not merge simultaneous stock usage.</p>
  </div>;
}
