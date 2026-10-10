import { localBackend } from './local-backend';
import { captureAccountSession, isAccountSessionCurrent } from './auth';
import { apiFetch, getApiErrorMessage } from './http';
import type { Notification } from './collaboration';
const uncertain=new Map<string,string>();
const pendingReadAll=new Map<string,string[]>();
function session(){const s=captureAccountSession();if(!s)throw new Error('Sign in to use notifications');return s;}
export async function listNotifications():Promise<Notification[]>{
  const s=session();let records:Notification[];
  if(localBackend.isAvailable()){
    records=await localBackend.invoke('list_local_notifications',{expectedAccountId:s.accountId});
    if(!Array.isArray(records))throw new Error('Local notifications unavailable; no server fallback');
  }else{
    const r=await apiFetch('/sync/notifications/pull',{cache:'no-store'});if(!r.ok)throw new Error(await getApiErrorMessage(r));
    const body=await r.json();if(body.snapshot_complete!==true||!Array.isArray(body.records))throw new Error('Incomplete notification snapshot');records=body.records;
  }
  if(!isAccountSessionCurrent(s))throw new Error('Account changed while reading notifications');return records;
}
export async function markNotificationsRead(ids:string[]):Promise<{ok:boolean;updated:number}>{
  const s=session();ids=[...new Set(ids)].sort();if(!ids.length)return{ok:true,updated:0};if(ids.length>1000)throw new Error('Read notifications in batches of at most 1000');
  if(localBackend.isAvailable()){
    const result=await localBackend.invoke<{ok:boolean;updated:number}>('mark_local_notifications_read',{ids,expectedAccountId:s.accountId});
    if(!result)throw new Error('Local notification write returned no result; no server fallback');
    if(!isAccountSessionCurrent(s))throw new Error('Account changed while saving notifications');return result;
  }
  const signature=JSON.stringify([s.accountId,ids]);let key=uncertain.get(signature);if(!key){key=crypto.randomUUID();uncertain.set(signature,key);}
  const r=await apiFetch('/collaboration/notifications/read-all',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({ids})});
  if(!r.ok){if(r.status>=400&&r.status<500)uncertain.delete(signature);throw new Error(await getApiErrorMessage(r));}
  const result=await r.json();uncertain.delete(signature);if(!isAccountSessionCurrent(s))throw new Error('Account changed while saving notifications');return result;
}
export async function markAllVisibleNotificationsRead(){
  const s=session();let ids=pendingReadAll.get(s.accountId);
  if(!ids){const rows=await listNotifications();if(!isAccountSessionCurrent(s))throw new Error('Account changed');ids=rows.filter(r=>!r.read_at).map(r=>r.id);pendingReadAll.set(s.accountId,ids);}
  let updated=0;
  for(let i=0;i<ids.length;i+=1000){if(!isAccountSessionCurrent(s))throw new Error('Account changed');updated+=(await markNotificationsRead(ids.slice(i,i+1000))).updated;}
  pendingReadAll.delete(s.accountId);
  return {ok:true,updated};
}
