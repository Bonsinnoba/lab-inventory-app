import { invoke } from '@tauri-apps/api/tauri';
import { apiFetch, getApiErrorMessage } from './http';

type PendingChange = { change_id:string; device_id:string; entity_type:string; entity_id?:string|null; operation:string; payload:unknown; created_at:string; attempt_count:number; last_error?:string|null };
type SyncResult = { change_id:string; status:'synced'|'failed'|'rejected'; result?:unknown; error?:{code?:string;message?:string} };
type PullResponse = { items?:unknown[]; deleted_item_ids?:string[]; next_cursor?:string|null; has_more?:boolean };
export type SyncRuntimeState = { status:'offline'|'syncing'|'idle'|'error'; lastSuccessAt:string|null; lastError:string|null };

const STATUS_KEY='labos.sync.status.v1';
let activeSync:Promise<number>|null=null;
let runtimeState:SyncRuntimeState={status:'idle',lastSuccessAt:null,lastError:null};
const listeners=new Set<(state:SyncRuntimeState)=>void>();

function loadRuntimeState():SyncRuntimeState{try{if(typeof localStorage==='undefined')return runtimeState;const raw=localStorage.getItem(STATUS_KEY);if(!raw)return runtimeState;const parsed=JSON.parse(raw) as Partial<SyncRuntimeState>;return {status:'idle',lastSuccessAt:typeof parsed.lastSuccessAt==='string'?parsed.lastSuccessAt:null,lastError:typeof parsed.lastError==='string'?parsed.lastError:null};}catch{return runtimeState;}}
runtimeState=loadRuntimeState();
function publish(patch:Partial<SyncRuntimeState>){runtimeState={...runtimeState,...patch};try{localStorage.setItem(STATUS_KEY,JSON.stringify({lastSuccessAt:runtimeState.lastSuccessAt,lastError:runtimeState.lastError}));}catch{}listeners.forEach(listener=>listener(runtimeState));}
export function getSyncRuntimeState():SyncRuntimeState{return runtimeState;}
export function subscribeSyncStatus(listener:(state:SyncRuntimeState)=>void):()=>void{listeners.add(listener);listener(runtimeState);return()=>listeners.delete(listener);}

export async function getPendingSyncCount():Promise<number>{try{const status=await invoke<{pending_sync_count:number}>('local_database_status');return Number(status.pending_sync_count||0);}catch{return 0;}}
export async function getSyncConflictCount():Promise<number>{try{const status=await invoke<{sync_conflict_count:number}>('local_database_status');return Number(status.sync_conflict_count||0);}catch{return 0;}}
export async function listSyncConflicts():Promise<unknown[]>{try{return await invoke<unknown[]>('list_sync_conflicts');}catch{return [];}}
export async function resolveSyncConflict(changeId:string,resolution:'keep_local'|'accept_server'|'dismiss'):Promise<void>{await invoke('resolve_sync_conflict',{changeId,resolution});}
export async function syncPendingChanges():Promise<number>{if(activeSync)return activeSync;activeSync=runSync().finally(()=>{activeSync=null;});return activeSync;}

async function runSync():Promise<number>{
  if(typeof navigator!=='undefined'&&!navigator.onLine){publish({status:'offline'});return 0;}
  publish({status:'syncing',lastError:null});
  let changes:PendingChange[]=[];
  try{changes=await invoke<PendingChange[]>('list_pending_sync_changes',{limit:100});}
  catch(error){const message=error instanceof Error?error.message:String(error);publish({status:'error',lastError:message});return 0;}
  let syncedCount=0;
  let syncSucceeded=true;
  if(changes.length){
    const deviceId=changes[0].device_id;
    try{
      const response=await apiFetch('/sync/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:deviceId,changes:changes.map(({change_id,entity_type,entity_id,operation,payload})=>({change_id,entity_type,entity_id,operation,payload}))})});
      if(response.ok){
        const body=await response.json() as {results?:SyncResult[]};
        const results=Array.isArray(body.results)?body.results:[];
        const synced=results.filter(r=>r.status==='synced').map(r=>r.change_id).filter(Boolean);
        if(synced.length){await invoke('mark_sync_changes_synced',{changeIds:synced});syncedCount=synced.length;}
        for(const result of results.filter(r=>r.status!=='synced')){
          syncSucceeded=false;
          if(result.error?.code==='SYNC_CONFLICT'){
            const change=changes.find(c=>c.change_id===result.change_id);
            if(change)await invoke('record_sync_conflict',{changeId:change.change_id,entityType:change.entity_type,entityId:change.entity_id??null,operation:change.operation,payloadJson:JSON.stringify(change.payload),errorCode:result.error.code,errorMessage:result.error.message||'This offline change conflicts with a newer server change'}).catch(()=>undefined);
          }else await invoke('record_sync_failure',{changeId:result.change_id,error:result.error?.message||result.error?.code||'Server rejected sync change'}).catch(()=>undefined);
        }
      }else{
        syncSucceeded=false;
        const message=await getApiErrorMessage(response,'Unable to synchronize local changes');
        for(const change of changes)await invoke('record_sync_failure',{changeId:change.change_id,error:message}).catch(()=>undefined);
        publish({status:'error',lastError:message});
      }
    }catch(error){
      syncSucceeded=false;
      const message=error instanceof Error?error.message:String(error);
      for(const change of changes)await invoke('record_sync_failure',{changeId:change.change_id,error:message}).catch(()=>undefined);
      publish({status:'error',lastError:message});
    }
  }
  const pullSucceeded=await pullServerInventory();
  if(!pullSucceeded){syncSucceeded=false;publish({status:'error',lastError:runtimeState.lastError||'Unable to download the latest server changes'});}
  if(syncSucceeded&&pullSucceeded)publish({status:'idle',lastSuccessAt:new Date().toISOString(),lastError:null});
  else if(runtimeState.status!=='error')publish({status:'error',lastError:runtimeState.lastError||'Some changes could not be synchronized'});
  return syncedCount;
}

function isCompositeCursor(cursor:string):boolean{try{const padded=cursor.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(cursor.length/4)*4,'=');const parsed=JSON.parse(atob(padded));return Boolean(parsed&&typeof parsed.at==='string'&&(parsed.type==='item'||parsed.type==='delete')&&typeof parsed.id==='string');}catch{return false;}}

async function pullServerInventory():Promise<boolean>{
  if(typeof navigator!=='undefined'&&!navigator.onLine){publish({status:'offline'});return false;}
  try{
    let cursor=await invoke<string|null>('get_inventory_sync_cursor');
    if(cursor&&!isCompositeCursor(cursor))cursor=null;
    for(let page=0;page<100;page++){
      const query=cursor?`/sync/pull?since=${encodeURIComponent(cursor)}&limit=500`:'/sync/pull?limit=500';
      const response=await apiFetch(query,{method:'GET',cache:'no-store'});
      if(!response.ok){publish({status:'error',lastError:await getApiErrorMessage(response,'Unable to download server changes')});return false;}
      const body=await response.json() as PullResponse;
      const items=Array.isArray(body.items)?body.items:[];
      const deletedItemIds=Array.isArray(body.deleted_item_ids)?body.deleted_item_ids:[];
      if(!items.length&&!deletedItemIds.length){if(!body.has_more)return true;return false;}
      if(!body.next_cursor)return false;
      await invoke('apply_server_inventory_pull',{itemsJson:JSON.stringify(items),deletedItemIds,nextCursor:body.next_cursor});
      cursor=body.next_cursor;
      if(!body.has_more)return true;
    }
    return false;
  }catch(error){publish({status:'error',lastError:error instanceof Error?error.message:String(error)});return false;}
}
