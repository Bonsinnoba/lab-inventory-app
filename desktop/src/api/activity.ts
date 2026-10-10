import { localBackend } from './local-backend';
import { captureAccountSession, isAccountSessionCurrent, captureServerRequest, isServerRequestCurrent, getToken } from './auth';
import { apiFetch, getApiErrorMessage } from './http';
import type { ActivityItem } from './collaboration';

export interface ActivityFeed {
  items:ActivityItem[]; next_before:string|null;
  state?:'available'|'not_downloaded'|'restricted'; last_synced_at?:string|null;
}

export async function listActivity(limit=40):Promise<ActivityFeed> {
  limit=Number.isFinite(limit)?Math.min(100,Math.max(1,Math.floor(limit))):40;
  const session=captureAccountSession();
  if(!session)throw new Error('Sign in to read activity');
  let result:ActivityFeed;
  if(localBackend.isAvailable()) {
    result=await localBackend.invoke<ActivityFeed>('list_local_activity',{expectedAccountId:session.accountId,limit});
    if(!result||!Array.isArray(result.items)||!['available','not_downloaded','restricted'].includes(result.state??''))throw new Error('Invalid local activity snapshot');
  } else {
    const response=await apiFetch(`/collaboration/activity?limit=${limit}`);
    if(!response.ok)throw new Error(await getApiErrorMessage(response,'Failed to load activity'));
    result=await response.json();
  }
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading activity');
  return result;
}

// Called by synchronization, not by the local page read. Failed refresh keeps
// the last complete snapshot; only a confirmed permission denial evicts it.
export async function pullActivitySnapshot():Promise<boolean> {
  const token=getToken();
  if(!token||token.startsWith('local:'))throw new Error('Reconnect to synchronize activity');
  const context=await captureServerRequest(token);
  const assertCurrent=()=>{
    if(!context.accountId||!context.nativeSessionToken||!isServerRequestCurrent(context))throw new Error('Session changed during activity synchronization');
  };
  assertCurrent();
  const response=await apiFetch('/collaboration/activity/snapshot',{cache:'no-store'});
  assertCurrent();
  const body=await response.json();assertCurrent();
  const denied=response.status===403&&['PERMISSION_DENIED','ADMIN_ROLE_REQUIRED'].includes(body?.error?.code);
  if(!response.ok&&!denied)throw new Error(body?.error?.message||'Unable to synchronize activity');
  if(!denied&&(body.snapshot_complete!==true||!Array.isArray(body.records)||!Number.isFinite(Date.parse(body.snapshot_at))))throw new Error('Incomplete activity snapshot');
  await localBackend.invoke('apply_server_activity_snapshot',{
    expectedAccountId:context.accountId,expectedSessionToken:context.nativeSessionToken,snapshot:denied?null:body,
  });
  assertCurrent();return true;
}
