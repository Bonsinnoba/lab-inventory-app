import { invoke } from '@tauri-apps/api/tauri';
import { captureAccountSession, isAccountSessionCurrent } from './auth';

export type ProjectDeleteRecoveryIndex = {records:{change_id:string;created_at:string;resolved_at:string;resolution:string}[];has_more:boolean};
export async function readSyncQueueCounts():Promise<{pending:number;unassigned:number;unassignedState:number}> {
  const session=captureAccountSession();
  if(!session)throw new Error('Sign in to read local sync status.');
  const result=await invoke<Record<string,unknown>>('get_local_sync_queue_status',{expectedAccountId:session.accountId});
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading sync status.');
  const count=(key:string)=>{
    const value=result[key];
    if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw new Error('Local sync status is incomplete.');
    return value;
  };
  return {pending:count('pending_sync_count'),unassigned:count('unassigned_pending_sync_count'),unassignedState:count('unassigned_state_count')};
}
export async function listProjectDeleteRecoveries():Promise<ProjectDeleteRecoveryIndex> {
  const session=captureAccountSession();
  if(!session)throw new Error('Sign in to view retained recovery records.');
  const result=await invoke<ProjectDeleteRecoveryIndex>('list_project_delete_recoveries',{expectedAccountId:session.accountId});
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while loading recovery records.');
  return result;
}

export async function listSyncConflicts():Promise<unknown[]> {
  const session=captureAccountSession();
  if(!session)throw new Error('Sign in to review saved sync conflicts.');
  const rows=await invoke<unknown[]>('list_sync_conflicts',{expectedAccountId:session.accountId});
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while loading conflicts.');
  return rows;
}

export async function resolveSyncConflict(changeId:string,resolution:'keep_local'|'accept_server'|'dismiss'):Promise<void> {
  const session=captureAccountSession();
  if(!session)throw new Error('Sign in to resolve saved sync conflicts.');
  await invoke('resolve_sync_conflict',{changeId,resolution,expectedAccountId:session.accountId});
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while resolving the conflict. Refresh before continuing.');
}
