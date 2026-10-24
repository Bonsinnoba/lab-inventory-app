import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, GitMerge, CheckCircle2 } from 'lucide-react';
import { listSyncConflicts, resolveSyncConflict, syncPendingChanges } from '../api/sync';
import { useToast } from '../contexts/ToastContext';
import ProjectConflictActions from '../components/ProjectConflictActions';
import { projectConflictGuidance } from '../api/project-conflict-guidance';
import { listProjectDeleteRecoveries, type ProjectDeleteRecoveryIndex } from '../api/sync-conflict-client';
import { createAccountReadGate } from '../api/account-read-gate';
import { captureAccountSession, isAccountSessionCurrent } from '../api/auth';

type Conflict = { change_id:string; entity_type:string; entity_id?:string|null; operation:string; payload:unknown; error_code:string; error_message:string; created_at:string; access_restricted?:boolean };

export default function SyncConflictsPage(){
  const {showToast}=useToast();
  const [conflicts,setConflicts]=useState<Conflict[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [recovery,setRecovery]=useState<ProjectDeleteRecoveryIndex|null>(null);
  const [recoveryError,setRecoveryError]=useState<string|null>(null);
  const readGate=useRef(createAccountReadGate());
  async function refresh(){
    const current=readGate.current.begin();
    setLoading(true);
    await Promise.all([
      (async()=>{
        try{const rows=await listSyncConflicts() as Conflict[];if(current()){setConflicts(rows);setError(null)}}
        catch(e){if(current()){setConflicts([]);setError(e instanceof Error?e.message:String(e))}}
        finally{if(current())setLoading(false)}
      })(),
      (async()=>{
        try{const rows=await listProjectDeleteRecoveries();if(current()){setRecovery(rows);setRecoveryError(null)}}
        catch(e){if(current()){setRecovery(null);setRecoveryError(e instanceof Error?e.message:String(e))}}
      })(),
    ]);
  }
  useEffect(()=>{
    const clear=()=>{
      readGate.current.invalidate();setConflicts([]);setRecovery(null);
      setError(null);setRecoveryError(null);setBusy(null);setLoading(false);
    };
    const changed=()=>{clear();if(captureAccountSession())void refresh()};
    void refresh();
    window.addEventListener('labos-user-updated',changed);
    window.addEventListener('labos:auth-expired',clear);
    return ()=>{
      readGate.current.invalidate();
      window.removeEventListener('labos-user-updated',changed);
      window.removeEventListener('labos:auth-expired',clear);
    };
  },[]);
  async function resolve(change:Conflict,resolution:'keep_local'|'accept_server'){
    const session=captureAccountSession();
    const explanation=resolution==='accept_server'?(['item','item_movement','maintenance_record','daily_preferences','supplier','storage_container','project_comment'].includes(change.entity_type)?'Discard pending changes to this record and connected inventory items/shared batches, then retrieve server values?':'Discard this pending local change and retrieve the server version?'):'Retry the local change? The server may reject it again.';
    const guidance=projectConflictGuidance(change);
    if(resolution==='keep_local'&&guidance?.retryBlocked)return;
    if(!window.confirm(resolution==='accept_server'&&guidance?guidance.confirmation:explanation))return;
    setBusy(change.change_id);
    try{
      await resolveSyncConflict(change.change_id,resolution);
      if(!isAccountSessionCurrent(session))return;
      await syncPendingChanges(true);
      if(!isAccountSessionCurrent(session))return;
      window.dispatchEvent(new Event('labos:manual-sync-complete'));
      await refresh();
      if(!isAccountSessionCurrent(session))return;
      showToast(resolution==='accept_server'?(guidance?.result??'Server version selected; synchronize to refresh local data.'):'Local change queued for retry.');
    }catch(e){if(isAccountSessionCurrent(session))showToast(e instanceof Error?e.message:'Unable to resolve conflict','error')}
    finally{if(isAccountSessionCurrent(session))setBusy(null)}
  }
  return <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold text-text-primary flex items-center gap-2"><GitMerge size={24}/> Sync conflicts</h1><p className="text-sm text-text-secondary mt-1">Review offline changes rejected by the server before choosing a resolution.</p></div><button className="px-3 py-2 border border-border rounded-lg text-sm flex items-center gap-2" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={16}/> Refresh</button></div>
    {error&&<div role="alert" className="text-status-danger">{error}</div>}
    {loading?<p className="text-text-secondary">Loading conflicts…</p>:conflicts.length===0?<div className="border border-border rounded-xl p-8 text-center"><CheckCircle2 className="mx-auto mb-2 text-status-success"/><p>No unresolved sync conflicts.</p></div>:<div className="space-y-3">{conflicts.map(c=><section key={c.change_id} className="border border-border rounded-xl p-4 bg-surface space-y-3">
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold capitalize">{c.entity_type.replaceAll('_',' ')} · {c.operation}</h2><p className="text-xs text-text-secondary break-all">{c.entity_id||c.change_id}</p></div><AlertTriangle className="text-status-warning shrink-0" size={20}/></div>
      <p className="text-sm">{c.error_message}</p><p className="text-xs text-text-secondary">Code: {c.error_code} · Recorded: {c.created_at}</p>
      {!c.access_restricted&&c.payload!=null&&<details className="text-sm"><summary className="cursor-pointer text-text-secondary">Inspect pending local change</summary><pre className="overflow-auto whitespace-pre-wrap break-all p-3 bg-surface-raised rounded-lg mt-2 text-xs">{JSON.stringify(c.payload,null,2)}</pre></details>}
      {projectConflictGuidance(c)?<ProjectConflictActions conflict={c} busy={busy!==null} onResolve={resolution=>void resolve(c,resolution)}/>:<div className="flex flex-wrap gap-2"><button disabled={busy!==null||c.access_restricted} onClick={()=>void resolve(c,'keep_local')} className="px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-50">Retry local change</button><button disabled={busy!==null} onClick={()=>void resolve(c,'accept_server')} className="px-3 py-2 border border-border rounded-lg text-sm disabled:opacity-50">Accept server version</button></div>}
    </section>)}</div>}
    <p className="text-xs text-text-secondary">For stock quantities, inspect movement history before resolving. Accepting the server version discards the pending local operation; it does not merge simultaneous stock usage.</p>
    <section className="rounded-xl border border-border bg-surface p-4 space-y-3" aria-label="Retained project recovery records">
      <h2 className="font-semibold">Retained project recovery records</h2>
      <p className="text-sm text-text-secondary">Cancelled deletion snapshots retained on this PC for your account. These are not live projects or backups of file contents. This view does not restore access or replay changes.</p>
      {recoveryError?<p role="status" className="text-sm text-status-warning">Recovery records could not be read: {recoveryError}</p>:recovery===null?<p className="text-sm text-text-secondary">Loading recovery records…</p>:recovery.records.length===0?<p className="text-sm text-text-secondary">No retained project-deletion snapshots for this account.</p>:<ul className="divide-y divide-border">
        {recovery.records.map(record=><li key={record.change_id} className="py-3 space-y-1">
          <p className="text-sm font-medium">Project deletion snapshot · retained</p>
          <p className="text-xs text-text-secondary">Recorded: {record.created_at} · Retired: {record.resolved_at}</p>
          <p className="text-xs text-text-secondary break-all">Change ID: {record.change_id}</p>
        </li>)}
      </ul>}
      {recovery?.has_more&&<p className="text-xs text-text-secondary">Showing the latest 50 records. Older records remain retained.</p>}
      <p className="text-xs text-text-secondary">Recovery payload inspection and export are not yet available here. Project names and content are deliberately excluded from this metadata-only view.</p>
    </section>
  </div>;
}
