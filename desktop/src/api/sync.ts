import { invoke } from '@tauri-apps/api/tauri';
import { apiFetch, getApiErrorMessage } from './http';
import { getToken } from './auth';

type PendingChange = { change_id:string; device_id:string; entity_type:string; entity_id?:string|null; operation:string; payload:unknown; created_at:string; attempt_count:number; last_error?:string|null };
type SyncResult = { change_id:string; status:'synced'|'failed'|'rejected'; result?:unknown; error?:{code?:string;message?:string} };
type LocationPullResponse = { locations?:unknown[]; deleted_location_ids?:string[] };
type EngineeringPullResponse = { calculations?:unknown[]; tests?:unknown[]; deleted_calculation_ids?:string[]; deleted_test_ids?:string[] };
type PullResponse = { items?:unknown[]; deleted_item_ids?:string[]; next_cursor?:string|null; has_more?:boolean };
type KnowledgePullResponse = { findings?:unknown[]; results?:unknown[]; relationships?:unknown[]; deleted?:{finding?:string[];knowledge_result?:string[];knowledge_relationship?:string[]} };
type NotesPullResponse = { notes?:unknown[]; deleted_note_ids?:string[] };
export type SyncRuntimeState = { status:'offline'|'syncing'|'idle'|'error'; lastSuccessAt:string|null; lastError:string|null };

const STATUS_KEY='labos.sync.status.v1';
const RETRY_KEY='labos.sync.retry.v1';
const RETRY_DELAYS_MS=[5000,15000,30000,60000,120000,300000];
let activeSync:Promise<number>|null=null;
let failureStreak=0;
let nextRetryAt=0;
let runtimeState:SyncRuntimeState={status:'idle',lastSuccessAt:null,lastError:null};
const listeners=new Set<(state:SyncRuntimeState)=>void>();

function loadRuntimeState():SyncRuntimeState{try{if(typeof localStorage==='undefined')return runtimeState;const raw=localStorage.getItem(STATUS_KEY);if(!raw)return runtimeState;const parsed=JSON.parse(raw) as Partial<SyncRuntimeState>;const lastError=typeof parsed.lastError==='string'&&parsed.lastError?parsed.lastError:null;return {status:lastError?'error':'idle',lastSuccessAt:typeof parsed.lastSuccessAt==='string'?parsed.lastSuccessAt:null,lastError};}catch{return runtimeState;}}
runtimeState=loadRuntimeState();
function loadRetryState(){try{if(typeof localStorage==='undefined')return;const raw=localStorage.getItem(RETRY_KEY);if(!raw)return;const parsed=JSON.parse(raw) as {retryAt?:unknown;streak?:unknown};const retryAt=typeof parsed.retryAt==='number'?parsed.retryAt:0;failureStreak=typeof parsed.streak==='number'&&parsed.streak>0?Math.floor(parsed.streak):0;nextRetryAt=retryAt>Date.now()?retryAt:0;}catch{failureStreak=0;nextRetryAt=0;}}
loadRetryState();
function persistRetryState(){try{localStorage.setItem(RETRY_KEY,JSON.stringify({retryAt:nextRetryAt,streak:failureStreak}));}catch{}}
function clearRetryState(){failureStreak=0;nextRetryAt=0;try{localStorage.removeItem(RETRY_KEY);}catch{}}
function scheduleRetry(){const delay=RETRY_DELAYS_MS[Math.min(failureStreak,RETRY_DELAYS_MS.length-1)];failureStreak+=1;nextRetryAt=Date.now()+delay;persistRetryState();}
function publish(patch:Partial<SyncRuntimeState>){runtimeState={...runtimeState,...patch};try{localStorage.setItem(STATUS_KEY,JSON.stringify({lastSuccessAt:runtimeState.lastSuccessAt,lastError:runtimeState.lastError}));}catch{}listeners.forEach(listener=>listener(runtimeState));}
export function getSyncRuntimeState():SyncRuntimeState{return runtimeState;}
export function subscribeSyncStatus(listener:(state:SyncRuntimeState)=>void):()=>void{listeners.add(listener);listener(runtimeState);return()=>listeners.delete(listener);}

export async function getPendingSyncCount():Promise<number>{try{const status=await invoke<{pending_sync_count:number}>('local_database_status');return Number(status.pending_sync_count||0);}catch{return 0;}}
export async function getSyncConflictCount():Promise<number>{try{const status=await invoke<{sync_conflict_count:number}>('local_database_status');return Number(status.sync_conflict_count||0);}catch{return 0;}}
export async function listSyncConflicts():Promise<unknown[]>{try{return await invoke<unknown[]>('list_sync_conflicts');}catch{return [];}}
export async function resolveSyncConflict(changeId:string,resolution:'keep_local'|'accept_server'|'dismiss'):Promise<void>{await invoke('resolve_sync_conflict',{changeId,resolution});}
export async function syncPendingChanges(force=false):Promise<number>{if(activeSync)return activeSync;if(!force&&nextRetryAt>Date.now()){return 0;}activeSync=runSync().finally(()=>{activeSync=null;});return activeSync;}

async function runPullStep(label:string, step:()=>Promise<boolean>):Promise<boolean>{
  try{
    const ok=await step();
    if(!ok) publish({status:'error',lastError:`${label}: ${runtimeState.lastError||'operation failed'}`});
    return ok;
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    publish({status:'error',lastError:`${label}: ${message}`});
    return false;
  }
}

async function runSync():Promise<number>{
  if(typeof navigator!=='undefined'&&!navigator.onLine){publish({status:'offline'});return 0;}
  const token=getToken();
  if(!token||token.startsWith('local:')){publish({status:'offline',lastError:'Reconnect to LabOS to synchronize this installation'});return 0;}
  publish({status:'syncing',lastError:null});
  let changes:PendingChange[]=[];
  try{changes=await invoke<PendingChange[]>('list_pending_sync_changes',{limit:100});}
  catch(error){const message=error instanceof Error?error.message:String(error);publish({status:'error',lastError:message});scheduleRetry();return 0;}
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
        const rejectedOrFailed=results.filter(r=>r.status!=='synced');
        if(rejectedOrFailed.some(r=>r.status==='failed'))scheduleRetry();
        for(const result of rejectedOrFailed){
          syncSucceeded=false;
          const change=changes.find(c=>c.change_id===result.change_id);
          if(!change)continue;
          if(result.status==='rejected'||result.error?.code==='SYNC_CONFLICT'){
            await invoke('record_sync_conflict',{changeId:change.change_id,entityType:change.entity_type,entityId:change.entity_id??null,operation:change.operation,payloadJson:JSON.stringify(change.payload),errorCode:result.error?.code||'SYNC_REJECTED',errorMessage:result.error?.message||'The server rejected this offline change'}).catch(()=>undefined);
          }else{
            await invoke('record_sync_failure',{changeId:change.change_id,error:result.error?.message||result.error?.code||'Unable to apply sync change'}).catch(()=>undefined);
          }
        }
      }else{
        syncSucceeded=false;
        const message=await getApiErrorMessage(response,'Unable to synchronize local changes');
        for(const change of changes)await invoke('record_sync_failure',{changeId:change.change_id,error:message}).catch(()=>undefined);
        publish({status:'error',lastError:`Sync push: ${message}`});
        scheduleRetry();
      }
    }catch(error){
      syncSucceeded=false;
      const message=error instanceof Error?error.message:String(error);
      for(const change of changes)await invoke('record_sync_failure',{changeId:change.change_id,error:message}).catch(()=>undefined);
      publish({status:'error',lastError:`Sync push: ${message}`});
      scheduleRetry();
    }
  }
  const inventoryPullSucceeded=await runPullStep('Inventory pull',pullServerInventory);
  const projectPullSucceeded=await runPullStep('Project pull',pullServerProjects);
  const resourcePullSucceeded=await runPullStep('Resource pull',pullServerResources);
  const financePullSucceeded=await runPullStep('Finance pull',pullServerFinance);
  const locationPullSucceeded=await runPullStep('Location pull',pullServerLocations);
  const engineeringPullSucceeded=await runPullStep('Engineering pull',pullServerEngineering);
  const knowledgePullSucceeded=await runPullStep('Knowledge pull',pullServerKnowledge);
  const notesPullSucceeded=await runPullStep('Notes pull',pullServerNotes);
  const pullSucceeded=inventoryPullSucceeded&&projectPullSucceeded&&resourcePullSucceeded&&financePullSucceeded&&locationPullSucceeded&&engineeringPullSucceeded&&knowledgePullSucceeded&&notesPullSucceeded;
  if(!pullSucceeded){syncSucceeded=false;publish({status:'error',lastError:runtimeState.lastError||'Unable to download the latest server changes'});scheduleRetry();}
  if(syncSucceeded&&pullSucceeded){clearRetryState();publish({status:'idle',lastSuccessAt:new Date().toISOString(),lastError:null});}
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


async function pullServerProjects():Promise<boolean>{
  if(typeof navigator!=='undefined'&&!navigator.onLine){publish({status:'offline'});return false;}
  try{
    const response=await apiFetch('/sync/projects/pull',{method:'GET',cache:'no-store'});
    if(!response.ok){publish({status:'error',lastError:await getApiErrorMessage(response,'Unable to download project changes')});return false;}
    const body=await response.json() as {projects?:unknown[];deleted_project_ids?:string[];deleted_project_entities?:Record<string,string[]>};
    const deleted=body.deleted_project_entities||{};
    await invoke('apply_server_project_pull',{projectsJson:JSON.stringify(Array.isArray(body.projects)?body.projects:[]),deletedProjectIds:Array.isArray(body.deleted_project_ids)?body.deleted_project_ids:[],deletedProjectTaskIds:Array.isArray(deleted.project_task)?deleted.project_task:[],deletedProjectExperimentIds:Array.isArray(deleted.project_experiment)?deleted.project_experiment:[],deletedProjectBomIds:Array.isArray(deleted.project_bom)?deleted.project_bom:[],deletedProjectBlockIds:Array.isArray(deleted.project_block)?deleted.project_block:[],deletedProjectConnectorIds:Array.isArray(deleted.project_connector)?deleted.project_connector:[],deletedProjectMeasurementIds:Array.isArray(deleted.project_experiment_measurement)?deleted.project_experiment_measurement:[],deletedProjectObservationIds:Array.isArray(deleted.project_experiment_observation)?deleted.project_experiment_observation:[],deletedProjectAttachmentIds:Array.isArray(deleted.project_work_attachment)?deleted.project_work_attachment:[],deletedProjectTaskExperimentIds:Array.isArray(deleted.project_task_experiment)?deleted.project_task_experiment:[],deletedProjectRequirementIds:Array.isArray(deleted.project_resource_requirement)?deleted.project_resource_requirement:[]});
    return true;
  }catch(error){publish({status:'error',lastError:error instanceof Error?error.message:String(error)});return false;}
}


async function pullServerResources():Promise<boolean>{
  if(typeof navigator!=='undefined'&&!navigator.onLine){publish({status:'offline'});return false;}
  try{
    const response=await apiFetch('/sync/resources/pull',{method:'GET',cache:'no-store'});
    if(!response.ok){publish({status:'error',lastError:await getApiErrorMessage(response,'Unable to download resource changes')});return false;}
    const body=await response.json() as {resources?:unknown[];deleted_resource_ids?:string[]};
    await invoke('apply_server_resource_pull',{resourcesJson:JSON.stringify(Array.isArray(body.resources)?body.resources:[]),deletedResourceIds:Array.isArray(body.deleted_resource_ids)?body.deleted_resource_ids:[]});
    return true;
  }catch(error){publish({status:'error',lastError:error instanceof Error?error.message:String(error)});return false;}
}


async function pullServerFinance():Promise<boolean>{if(typeof navigator!=='undefined'&&!navigator.onLine)return false;try{const response=await apiFetch('/sync/finance/pull',{method:'GET',cache:'no-store'});if(!response.ok)return false;const body=await response.json() as any;const d=body.deleted||{};await invoke('apply_server_finance_pull',{transactions:Array.isArray(body.transactions)?body.transactions:[],budgetPeriods:Array.isArray(body.budget_periods)?body.budget_periods:[],fundingSources:Array.isArray(body.funding_sources)?body.funding_sources:[],deletedTransactions:Array.isArray(d.transaction)?d.transaction:[],deletedBudgetPeriods:Array.isArray(d.budget_period)?d.budget_period:[],deletedFundingSources:Array.isArray(d.funding_source)?d.funding_source:[]});return true}catch{return false;}}


async function pullServerEngineering():Promise<boolean>{
  if(typeof navigator!=='undefined'&&!navigator.onLine)return false;
  try{
    const response=await apiFetch('/sync/engineering/pull',{method:'GET',cache:'no-store'});
    if(!response.ok){publish({status:'error',lastError:await getApiErrorMessage(response,'Unable to download engineering changes')});return false;}
    const body=await response.json() as EngineeringPullResponse;
    await invoke('apply_server_engineering_pull',{calculations:Array.isArray(body.calculations)?body.calculations:[],tests:Array.isArray(body.tests)?body.tests:[],deletedCalculationIds:Array.isArray(body.deleted_calculation_ids)?body.deleted_calculation_ids:[],deletedTestIds:Array.isArray(body.deleted_test_ids)?body.deleted_test_ids:[]});
    return true;
  }catch(error){publish({status:'error',lastError:error instanceof Error?error.message:String(error)});return false;}
}

async function pullServerKnowledge():Promise<boolean>{
  if(typeof navigator!=='undefined'&&!navigator.onLine)return false;
  try{
    const response=await apiFetch('/knowledge/sync/pull',{method:'GET',cache:'no-store'});
    if(!response.ok){publish({status:'error',lastError:await getApiErrorMessage(response,'Unable to download knowledge changes')});return false;}
    const body=await response.json() as KnowledgePullResponse;
    const deleted=body.deleted||{};
    await invoke('apply_server_knowledge_pull',{
      findings:Array.isArray(body.findings)?body.findings:[],
      results:Array.isArray(body.results)?body.results:[],
      relationships:Array.isArray(body.relationships)?body.relationships:[],
      deletedFindingIds:Array.isArray(deleted.finding)?deleted.finding:[],
      deletedResultIds:Array.isArray(deleted.knowledge_result)?deleted.knowledge_result:[],
      deletedRelationshipIds:Array.isArray(deleted.knowledge_relationship)?deleted.knowledge_relationship:[]
    });
    return true;
  }catch(error){publish({status:'error',lastError:error instanceof Error?error.message:String(error)});return false;}
}

async function pullServerNotes():Promise<boolean>{
  if(typeof navigator!=='undefined'&&!navigator.onLine)return false;
  try{
    const response=await apiFetch('/sync/notes/pull',{method:'GET',cache:'no-store'});
    if(!response.ok){publish({status:'error',lastError:await getApiErrorMessage(response,'Unable to download note changes')});return false;}
    const body=await response.json() as NotesPullResponse;
    await invoke('apply_server_notes_pull',{notes:Array.isArray(body.notes)?body.notes:[],deletedNoteIds:Array.isArray(body.deleted_note_ids)?body.deleted_note_ids:[]});
    return true;
  }catch(error){publish({status:'error',lastError:error instanceof Error?error.message:String(error)});return false;}
}

async function pullServerLocations():Promise<boolean>{
  if(typeof navigator!=='undefined'&&!navigator.onLine)return false;
  try{
    const response=await apiFetch('/sync/locations/pull',{method:'GET',cache:'no-store'});
    if(!response.ok){publish({status:'error',lastError:await getApiErrorMessage(response,'Unable to download location changes')});return false;}
    const body=await response.json() as LocationPullResponse;
    await invoke('apply_server_location_pull',{locationsJson:JSON.stringify(Array.isArray(body.locations)?body.locations:[]),deletedLocationIds:Array.isArray(body.deleted_location_ids)?body.deleted_location_ids:[]});
    return true;
  }catch(error){publish({status:'error',lastError:error instanceof Error?error.message:String(error)});return false;}
}
