import {useState} from 'react';
import {invoke} from '@tauri-apps/api/tauri';
import {captureAccountSession,isAccountSessionCurrent} from '../api/auth';
import {isTauriRuntime} from '../lib/runtime';
type Row={change_id:string;resource_id:string;operation:string;name:string;pending:boolean;exportable:boolean;legacy_unverified:boolean};
type Storage={quota_bytes:number;allocated_bytes:number;reclaimed_bytes:number;preserved:number;pending_protected:boolean;scope:string};
export default function ResourceRecoveryPanel(){
 const [rows,setRows]=useState<Row[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[truncated,setTruncated]=useState(false),[storage,setStorage]=useState<Storage|null>(null),[quota,setQuota]=useState('0'),[details,setDetails]=useState<Record<string,string>>({});
 if(!isTauriRuntime())return null;
 const load=async()=>{const owner=captureAccountSession();if(!owner)return;setBusy(true);setError('');try{
  const result=await invoke<{records:Row[];truncated:boolean}>('list_local_resource_recovery',{expectedAccountId:owner.accountId});if(!isAccountSessionCurrent(owner))return;setRows(result.records);setTruncated(result.truncated);setLoaded(true);
 }catch(e){if(isAccountSessionCurrent(owner))setError(String(e))}finally{if(isAccountSessionCurrent(owner))setBusy(false)}};
 const storageAction=async(reclaim:boolean,save=false)=>{const owner=captureAccountSession();if(!owner)return;setBusy(true);setError('');try{
  const amount=Number(quota);if(save&&(!Number.isFinite(amount)||amount<0||amount>1024))throw Error('Enter 0–1024 GiB; zero means unlimited');
  const token=await invoke<string>('local_authorization_guard',{expectedAccountId:owner.accountId});if(!isAccountSessionCurrent(owner))return;
  const result=await invoke<Storage>('manage_local_resource_storage',{expectedAccountId:owner.accountId,expectedSessionToken:token,reclaim,quotaBytes:save?Math.floor(amount*1024**3):null});if(!isAccountSessionCurrent(owner))return;setStorage(result);setQuota(String(result.quota_bytes/1024**3));
 }catch(e){if(isAccountSessionCurrent(owner))setError(String(e))}finally{if(isAccountSessionCurrent(owner))setBusy(false)}};
 const reviewDetails=async(row:Row)=>{const owner=captureAccountSession();if(!owner)return;setBusy(true);setError('');try{
  const token=await invoke<string>('local_authorization_guard',{expectedAccountId:owner.accountId});if(!isAccountSessionCurrent(owner))return;
  const result=await invoke<Record<string,unknown>>('read_local_resource_recovery_details',{expectedAccountId:owner.accountId,expectedSessionToken:token,changeId:row.change_id});if(!isAccountSessionCurrent(owner))return;
  const labels:Record<string,string>={name:'Name',description:'Description',category:'Category',tags:'Tags',destination:'Destination',reviewed_members:'Reviewed members',source_id:'Source resource'};
  const text=Object.entries(labels).filter(([key])=>result[key]!==null&&result[key]!==undefined).map(([key,label])=>label+': '+(typeof result[key]==='string'?result[key]:JSON.stringify(result[key]))).join('\n');
  setDetails(values=>({...values,[row.change_id]:(text||'The original intention is retained in your owner recovery package.')+(result.description_truncated?'\nLong description excerpt; complete original remains in your recovery package.':'')}));
 }catch(e){if(isAccountSessionCurrent(owner))setError(String(e))}finally{if(isAccountSessionCurrent(owner))setBusy(false)}};
 const exportVersion=async(row:Row)=>{const owner=captureAccountSession();if(!owner)return;setBusy(true);setError('');try{
  const token=await invoke<string>('local_authorization_guard',{expectedAccountId:owner.accountId});if(!isAccountSessionCurrent(owner))return;
  await invoke('export_local_resource_recovery',{expectedAccountId:owner.accountId,expectedSessionToken:token,changeId:row.change_id});
 }catch(e){if(isAccountSessionCurrent(owner))setError(String(e))}finally{if(isAccountSessionCurrent(owner))setBusy(false)}};
 return <details className="border-t border-border px-4 py-3 text-xs"><summary className="cursor-pointer">Saved resource work &amp; device storage</summary><div className="mt-3 space-y-3">
  <p>Review preserved intentions and export verified authored versions. Export does not replay changes or restore access. Unknown legacy files remain available through owner recovery packages.</p>
  <button disabled={busy} onClick={()=>void load()} className="border border-border rounded px-2 py-1 disabled:opacity-40">{loaded?'Refresh saved versions':'Load saved versions'}</button>
  {loaded&&!rows.length&&<p>No pending or archived resource intentions for this account.</p>}
  <div className="max-h-48 overflow-y-auto space-y-2">{rows.map(row=><div key={row.change_id} className="border border-border rounded p-2"><div className="truncate" title={row.name}>{row.name}</div><p>{row.operation} · {row.pending?'Pending':'Preserved after review'} · {row.change_id.slice(0,8)}</p><button disabled={busy} onClick={()=>void reviewDetails(row)} className="block text-accent disabled:opacity-40">Review saved details</button>{details[row.change_id]&&<p className="whitespace-pre-wrap break-words mt-1">{details[row.change_id]}</p>}{row.exportable?<button disabled={busy} onClick={()=>void exportVersion(row)} className="text-accent disabled:opacity-40">Export this saved version</button>:<p>{row.legacy_unverified?'Legacy provenance unverified; retain owner recovery package.':'Metadata intention retained; no file bytes attached.'}</p>}</div>)}</div>
  {truncated&&<p>Showing the latest 500 intentions. An owner recovery package preserves the complete history.</p>}
  <button disabled={busy} onClick={()=>void storageAction(false)} className="border border-border rounded px-2 py-1">Inspect device copies</button>
  {storage&&<div className="space-y-2"><p>Allocated current copies: {(storage.allocated_bytes/1024**3).toFixed(2)} GiB. Reclaimed: {(storage.reclaimed_bytes/1024**2).toFixed(1)} MiB.</p><p>{storage.scope}</p>{storage.pending_protected&&<p>Pending resource work protects all retained copies.</p>}<label>Current-copy quota (GiB, 0 = unlimited)<input type="number" min="0" max="1024" value={quota} onChange={e=>setQuota(e.target.value)} className="w-full bg-surface border border-border rounded p-1"/></label><div className="flex gap-2"><button disabled={busy} onClick={()=>void storageAction(false,true)} className="border border-border px-2 py-1 rounded">Save quota</button><button disabled={busy} onClick={()=>void storageAction(true)} className="border border-border px-2 py-1 rounded">Reclaim eligible derived copies</button></div><p>Quota pauses new replication; it never evicts authored or recoverable work. Partial and unknown files are retained.</p></div>}
  {error&&<p role="alert" className="text-status-danger break-words">{error}</p>}
 </div></details>;
}
