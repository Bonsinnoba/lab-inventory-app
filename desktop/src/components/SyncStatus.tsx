import { AlertTriangle, Check, Cloud, Loader2, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../contexts/ToastContext';
import ProjectConflictActions from './ProjectConflictActions';
import { projectConflictGuidance } from '../api/project-conflict-guidance';
import { getSyncRuntimeState, listSyncConflicts, resolveSyncConflict, subscribeSyncStatus, syncPendingChanges, type SyncRuntimeState } from '../api/sync';
import { createAccountReadGate } from '../api/account-read-gate';
import { readSyncQueueCounts } from '../api/sync-conflict-client';
import { captureAccountSession, isAccountSessionCurrent } from '../api/auth';

type Conflict={change_id:string;entity_type:string;entity_id?:string|null;operation:string;error_code?:string;access_restricted?:boolean;error_message:string;created_at:string};

function formatLastSync(value:string|null):string{
  if(!value)return 'No successful sync yet';
  const elapsed=Math.max(0,Date.now()-new Date(value).getTime());
  const minutes=Math.floor(elapsed/60000);
  if(minutes<1)return 'Synced just now';
  if(minutes<60)return `Synced ${minutes}m ago`;
  const hours=Math.floor(minutes/60);
  if(hours<24)return `Synced ${hours}h ago`;
  return `Synced ${Math.floor(hours/24)}d ago`;
}

export default function SyncStatus(){
  const {showToast}=useToast();
  const [pending,setPending]=useState<number|null>(null);
  const [unassigned,setUnassigned]=useState(0);
  const [unassignedState,setUnassignedState]=useState(0);
  const [conflicts,setConflicts]=useState<Conflict[]>([]);
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [readError,setReadError]=useState<string|null>(null);
  const readGate=useRef(createAccountReadGate());
  const [runtime,setRuntime]=useState<SyncRuntimeState>(getSyncRuntimeState());
  const refresh=async()=>{
    const current=readGate.current.begin();
    try{
      const [counts,rows]=await Promise.all([readSyncQueueCounts(),listSyncConflicts()]);
      if(!current())return;
      setPending(counts.pending);setUnassigned(counts.unassigned);setUnassignedState(counts.unassignedState);
      setConflicts(rows as Conflict[]);setReadError(null);
    }catch(error){if(current()){setPending(null);setUnassigned(0);setUnassignedState(0);setConflicts([]);setReadError(error instanceof Error?error.message:String(error));}}
  };
  useEffect(()=>{
    const clear=()=>{readGate.current.invalidate();setPending(null);setUnassigned(0);setUnassignedState(0);setConflicts([]);setReadError(null);setBusy(false);setOpen(false);};
    const changed=()=>{clear();if(captureAccountSession())void refresh()};
    void refresh();const unsubscribe=subscribeSyncStatus(setRuntime);
    const timer=window.setInterval(()=>{if(captureAccountSession())void refresh()},5000);
    const online=()=>void refresh();const offline=()=>setRuntime(getSyncRuntimeState());
    window.addEventListener('online',online);window.addEventListener('offline',offline);
    window.addEventListener('labos-user-updated',changed);window.addEventListener('labos:auth-expired',clear);
    return()=>{readGate.current.invalidate();unsubscribe();window.clearInterval(timer);window.removeEventListener('online',online);window.removeEventListener('offline',offline);window.removeEventListener('labos-user-updated',changed);window.removeEventListener('labos:auth-expired',clear);};
  },[]);
  const sync=async()=>{
    const session=captureAccountSession();setBusy(true);
    try{await syncPendingChanges(true);if(isAccountSessionCurrent(session))window.dispatchEvent(new Event('labos:manual-sync-complete'));}
    catch(error){if(isAccountSessionCurrent(session))showToast(error instanceof Error?error.message:String(error),'error');}
    finally{if(isAccountSessionCurrent(session)){setBusy(false);await refresh();}}
  };
  const resolve=async(id:string,resolution:'keep_local'|'accept_server'|'dismiss')=>{
    const session=captureAccountSession();
    const conflict=conflicts.find(c=>c.change_id===id);
    const guidance=conflict?projectConflictGuidance(conflict):null;
    if(resolution==='keep_local'&&guidance?.retryBlocked)return;
    if(resolution!=='keep_local'&&guidance&&!window.confirm(guidance.confirmation))return;
    if(resolution!=='keep_local'&&conflict?.entity_type==='resource'&&['create','create_copy','edit_content'].includes(conflict.operation)&&!window.confirm('Stop syncing this resource change and the pending copies or edits that depend on it? Saved file bytes will be retained for recovery, but these changes will no longer be sent to the server.'))return;
    if(resolution!=='keep_local'&&['item','item_movement','maintenance_record','daily_preferences','supplier','storage_container','project_comment'].includes(conflicts.find(c=>c.change_id===id)?.entity_type??'')&&!window.confirm('Discard pending changes to this record and connected inventory items/shared batches, then restore server values?'))return;
    setBusy(true);
    try{await resolveSyncConflict(id,resolution);if(!isAccountSessionCurrent(session))return;await syncPendingChanges(true);if(isAccountSessionCurrent(session))window.dispatchEvent(new Event('labos:manual-sync-complete'));}
    catch(error){if(isAccountSessionCurrent(session))showToast(error instanceof Error?error.message:String(error),'error');}
    finally{if(isAccountSessionCurrent(session)){setBusy(false);await refresh();}}
  };
  const count=conflicts.length;
  const offline=typeof navigator!=='undefined'&&!navigator.onLine;
  const effectiveStatus=offline?'offline':runtime.status;
  const title=readError?'Local sync status unavailable':effectiveStatus==='offline'?'Offline — changes are saved locally':effectiveStatus==='syncing'?'Syncing changes…':effectiveStatus==='error'?`Sync needs attention: ${runtime.lastError||'retry required'}`:count?`${count} sync conflict${count===1?'':'s'}`:formatLastSync(runtime.lastSuccessAt);
  return <div className="relative">
    <button type="button" onClick={()=>setOpen(v=>!v)} className="relative p-2 rounded-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70" aria-label={title} title={title}>
      {readError?<AlertTriangle size={18}/>:effectiveStatus==='offline'?<WifiOff size={18}/>:effectiveStatus==='syncing'?<Loader2 size={18} className="animate-spin"/>:count||effectiveStatus==='error'?<AlertTriangle size={18}/>:<Cloud size={18}/>}
      {count>0&&<span className="absolute right-0.5 top-0.5 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-black text-[9px] font-bold flex items-center justify-center">{count>9?'9+':count}</span>}
      {!count&&effectiveStatus==='error'&&<span className="absolute right-0.5 top-0.5 w-2 h-2 rounded-full bg-amber-500"/>}
    </button>
    {open&&<div className="absolute right-0 top-11 z-50 w-[380px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-surface shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border"><div><div className="text-sm font-semibold flex items-center gap-2">{effectiveStatus==='offline'?<WifiOff size={15}/>:effectiveStatus==='syncing'?<Loader2 size={15} className="animate-spin"/>:effectiveStatus==='error'?<AlertTriangle size={15}/>:<Cloud size={15}/>} {effectiveStatus==='offline'?'Offline':effectiveStatus==='syncing'?'Syncing…':effectiveStatus==='error'?'Sync needs attention':'Sync status'}</div><div className="text-xs text-text-secondary mt-0.5">{pending===null?'Queue count unavailable':`${pending} pending change${pending===1?'':'s'}${count?` · ${count} conflict${count===1?'':'s'}`:' · no conflicts'}`}</div></div><button type="button" onClick={()=>setOpen(false)} className="p-1.5 text-text-secondary hover:text-text-primary" aria-label="Close"><X size={15}/></button></div>
      <div className="px-4 py-3 border-b border-border space-y-2">
        <div className="flex items-center gap-2 text-sm"><span className={`w-2 h-2 rounded-full ${effectiveStatus==='offline'?'bg-slate-400':effectiveStatus==='syncing'?'bg-accent':'bg-emerald-400'}`}/>{effectiveStatus==='offline'?'Changes will sync when you are back online.':effectiveStatus==='syncing'?'Uploading local changes and checking the server…':formatLastSync(runtime.lastSuccessAt)}</div>
        {runtime.status==='error'&&!offline&&<div className="text-xs text-amber-300 break-words">{runtime.lastError||'Some changes could not be synchronized.'}</div>}
        {unassigned>0&&<div className="text-xs text-amber-300">{unassigned} older change{unassigned===1?'':'s'} cannot be attributed to an account and will not upload automatically. Local data has been preserved.</div>}
        {unassignedState>0&&<div className="text-xs text-amber-300">{unassignedState} older cache entr{unassignedState===1?'y is':'ies are'} preserved but hidden because their account owner is unknown. Account-specific data will be rebuilt by sync.</div>}
      </div>
      {pending===null?<div role="status" className="px-4 py-5 text-sm text-text-secondary">{readError?`Local sync status could not be read: ${readError}`:'Reading local sync status…'}</div>:count===0?<div className="px-4 py-5 text-sm text-text-secondary flex items-center gap-2"><Check size={16} className="text-emerald-400"/> No sync conflicts need attention.</div>:<div className="max-h-80 overflow-auto divide-y divide-border">{conflicts.map(c=><div key={c.change_id} className="px-4 py-3">
        <div className="text-sm font-medium">{c.entity_type.replace('_',' ')} {c.entity_id?`· ${c.entity_id.slice(0,8)}`:''}</div><div className="text-xs text-text-secondary mt-1">{c.error_message}</div>
        {projectConflictGuidance(c)?<div className="mt-3"><ProjectConflictActions conflict={c} busy={busy} onResolve={resolution=>void resolve(c.change_id,resolution)}/></div>:<div className="flex gap-2 mt-3"><button type="button" disabled={busy||offline||c.access_restricted} onClick={()=>void resolve(c.change_id,'keep_local')} className="px-2.5 py-1.5 rounded border border-accent text-accent text-xs hover:bg-accent/10 disabled:opacity-50">Keep local</button><button type="button" disabled={busy||offline} onClick={()=>void resolve(c.change_id,'accept_server')} className="px-2.5 py-1.5 rounded border border-border text-text-secondary text-xs hover:text-text-primary disabled:opacity-50">Accept server</button><button type="button" disabled={busy} onClick={()=>void resolve(c.change_id,'dismiss')} className="ml-auto p-1.5 text-text-secondary hover:text-text-primary disabled:opacity-50" title="Dismiss" aria-label="Dismiss"><X size={14}/></button></div>}
      </div>)}</div>}
      <div className="px-4 py-2.5 border-t border-border flex items-center justify-between"><span className="text-[11px] text-text-secondary">{offline?'Offline queue is safe':runtime.status==='error'?'Retry to continue':formatLastSync(runtime.lastSuccessAt)}</span><button type="button" disabled={busy||offline} onClick={()=>void sync()} className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline disabled:opacity-50"><Cloud size={13} className={busy?'animate-pulse':''}/> Retry sync</button></div>
    </div>}
  </div>;
}
