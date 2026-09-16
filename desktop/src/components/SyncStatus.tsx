import { AlertTriangle, Check, Cloud, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getPendingSyncCount, listSyncConflicts, resolveSyncConflict, syncPendingChanges } from '../api/sync';

type Conflict={change_id:string;entity_type:string;entity_id?:string|null;operation:string;error_message:string;created_at:string};

export default function SyncStatus(){
  const [pending,setPending]=useState(0); const [conflicts,setConflicts]=useState<Conflict[]>([]); const [open,setOpen]=useState(false); const [busy,setBusy]=useState(false);
  const refresh=async()=>{setPending(await getPendingSyncCount());setConflicts((await listSyncConflicts()) as Conflict[]);};
  useEffect(()=>{void refresh();const timer=window.setInterval(()=>void refresh(),5000);return()=>window.clearInterval(timer);},[]);
  const sync=async()=>{setBusy(true);try{await syncPendingChanges();}finally{setBusy(false);await refresh();}};
  const resolve=async(id:string,resolution:'keep_local'|'accept_server'|'dismiss')=>{setBusy(true);try{await resolveSyncConflict(id,resolution);await syncPendingChanges();}finally{setBusy(false);await refresh();}};
  const count=conflicts.length;
  return <div className="relative">
    <button type="button" onClick={()=>setOpen(v=>!v)} className="relative p-2 rounded-sm text-text-secondary hover:text-text-primary hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70" aria-label={count?`${count} sync conflicts`:'Sync status'} title={count?`${count} sync conflict${count===1?'':'s'}`:'Sync status'}>
      {count?<AlertTriangle size={18}/>:<Cloud size={18}/>} {count>0&&<span className="absolute right-0.5 top-0.5 min-w-4 h-4 px-1 rounded-full bg-amber-500 text-black text-[9px] font-bold flex items-center justify-center">{count>9?'9+':count}</span>}
    </button>
    {open&&<div className="absolute right-0 top-11 z-50 w-[360px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-surface shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border"><div><div className="text-sm font-semibold">Sync status</div><div className="text-xs text-text-secondary mt-0.5">{pending} pending change{pending===1?'':'s'}{count?` · ${count} conflict${count===1?'':'s'}`:' · all changes clear'}</div></div><button type="button" onClick={()=>setOpen(false)} className="p-1.5 text-text-secondary hover:text-text-primary" aria-label="Close"><X size={15}/></button></div>
      {count===0?<div className="px-4 py-5 text-sm text-text-secondary flex items-center gap-2"><Check size={16} className="text-emerald-400"/> No sync conflicts need attention.</div>:<div className="max-h-80 overflow-auto divide-y divide-border">{conflicts.map(c=><div key={c.change_id} className="px-4 py-3"><div className="text-sm font-medium">{c.entity_type.replace('_',' ')} {c.entity_id?`· ${c.entity_id.slice(0,8)}`:''}</div><div className="text-xs text-text-secondary mt-1">{c.error_message}</div><div className="flex gap-2 mt-3"><button type="button" disabled={busy} onClick={()=>void resolve(c.change_id,'keep_local')} className="px-2.5 py-1.5 rounded border border-accent text-accent text-xs hover:bg-accent/10 disabled:opacity-50">Keep local</button><button type="button" disabled={busy} onClick={()=>void resolve(c.change_id,'accept_server')} className="px-2.5 py-1.5 rounded border border-border text-text-secondary text-xs hover:text-text-primary disabled:opacity-50">Accept server</button><button type="button" disabled={busy} onClick={()=>void resolve(c.change_id,'dismiss')} className="ml-auto p-1.5 text-text-secondary hover:text-text-primary" title="Dismiss"><X size={14}/></button></div></div>)}</div>}
      <div className="px-4 py-2.5 border-t border-border flex justify-end"><button type="button" disabled={busy} onClick={()=>void sync()} className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline disabled:opacity-50"><RefreshCw size={13} className={busy?'animate-spin':''}/> Sync now</button></div>
    </div>}
  </div>;
}
