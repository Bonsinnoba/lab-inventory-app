import {processSyncReceipts,type SyncResult} from './sync-receipts';
import {applyInventoryPage} from './inventory-pull';
import {pullActivitySnapshot} from './activity';
import {pullDownloadSnapshot} from './downloads-local';
import {pullResourcePosters} from './resource-posters';
import {pullResourceFiles} from './resource-replication';
import {isResourceUpload,transferResourceUpload} from './resource-uploads';
import {withoutBlockedResources} from './resource-dependencies';
import {refreshResourceAuthority} from './resource-authority';
import {confirmResourceChange,confirmResourceMutation} from './resource-confirmation';
import type {Resource} from './resources';
import { invoke } from '@tauri-apps/api/tauri';
import { apiFetch, getApiErrorMessage } from './http';
import { getStoredUser, getToken, captureServerRequest, isServerRequestCurrent, captureAccountSession, isAccountSessionCurrent, type AccountSession } from './auth';
import { createSyncRuntimeStore, type SyncRuntimeState } from './sync-runtime-state';
import { readSyncQueueCounts, listSyncConflicts } from './sync-conflict-client';

type PendingChange = { change_id:string; device_id:string; entity_type:string; entity_id?:string|null; operation:string; payload:unknown; created_at:string; attempt_count:number; last_error?:string|null };
type LocationPullResponse = { snapshot_complete?:boolean; locations?:unknown[]; deleted_location_ids?:string[] };
type EngineeringPullResponse = { calculations?:unknown[]; tests?:unknown[]; visible_calculation_ids?:string[]; visible_test_ids?:string[]; deleted_calculation_ids?:string[]; deleted_test_ids?:string[] };
type PullResponse = { items?:unknown[]; deleted_item_ids?:string[]; next_cursor?:string|null; has_more?:boolean };
type KnowledgePullResponse = { findings?:unknown[]; results?:unknown[]; relationships?:unknown[]; visible_finding_ids?:string[]; visible_result_ids?:string[]; visible_relationship_ids?:string[]; deleted?:{finding?:string[];knowledge_result?:string[];knowledge_relationship?:string[]} };
type NotesPullResponse = { notes?:unknown[]; visible_note_ids?:string[]; deleted_note_ids?:string[] };
export type { SyncRuntimeState } from './sync-runtime-state';

let activeSync:Promise<number>|null=null;
const runtime=createSyncRuntimeStore({storage:()=>typeof localStorage==='undefined'?undefined:localStorage,session:captureAccountSession,isCurrent:isAccountSessionCurrent});
function clearRetryState(){runtime.clearRetry(currentSyncSession);}
function scheduleRetry(){runtime.scheduleRetry(currentSyncSession);}
function publish(patch:Partial<SyncRuntimeState>){runtime.publish(currentSyncSession,patch);}
export function getSyncRuntimeState():SyncRuntimeState{return runtime.getState();}
export function subscribeSyncStatus(listener:(state:SyncRuntimeState)=>void):()=>void{return runtime.subscribe(listener);}
if(typeof window!=='undefined'){
  window.addEventListener('labos-user-updated',runtime.refresh);
  window.addEventListener('labos:auth-expired',runtime.refresh);
}

export async function getPendingSyncCount():Promise<number>{return (await readSyncQueueCounts()).pending;}
export async function getUnassignedSyncCount():Promise<number>{return (await readSyncQueueCounts()).unassigned;}
export async function getUnassignedStateCount():Promise<number>{return (await readSyncQueueCounts()).unassignedState;}
export async function getSyncConflictCount():Promise<number>{return (await listSyncConflicts()).length;}
export { listSyncConflicts, resolveSyncConflict } from './sync-conflict-client';
export async function syncPendingChanges(force=false):Promise<number>{
  runtime.refresh();
  if(activeSync){
    if(!isAccountSessionCurrent(currentSyncSession))throw new Error('Previous login synchronization is finishing. Retry shortly.');
    return activeSync;
  }
  if(!force&&!runtime.retryDue())return 0;
  currentSyncSession=captureAccountSession();
  const session=currentSyncSession;
  activeSync=runSync().catch(error=>{
    // The automatic caller deliberately catches rejected runs. Publish first,
    // otherwise an exception outside a per-step handler leaves a false spinner.
    // Never acknowledge work or publish an old account's failure into a new one.
    const step=isAccountSessionCurrent(session)?runtime.getState().step:null;
    runtime.publish(session,{status:'error',lastError:`Sync interrupted${step?` (${step})`:''}: ${error instanceof Error?error.message:String(error)}`});
    runtime.scheduleRetry(session);
    throw error;
  }).finally(()=>{currentSyncSession=null;activeSync=null;});
  return activeSync;
}

type SyncSession=AccountSession;
let currentSyncSession:SyncSession|null=null;
function assertSyncSession(session:SyncSession|null=currentSyncSession):void{
  if(!isAccountSessionCurrent(session)){
    throw new Error('Account changed during sync. Sign in and retry.');
  }
}
function syncAccountId():string{assertSyncSession();return currentSyncSession!.accountId;}

async function runPullStep(label:string, step:()=>Promise<boolean>):Promise<boolean>{
  try{
    assertSyncSession();
    publish({step:label});
    const ok=await step();
    assertSyncSession();
    if(!ok) publish({status:'error',lastError:`${label}: ${getSyncRuntimeState().lastError||'operation failed'}`});
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
  const accountId=getStoredUser()?.id;
  if(!accountId){publish({status:'error',lastError:'Sign in again before synchronizing local changes'});return 0;}
  let unassigned:number;
  try{unassigned=await getUnassignedSyncCount();}
  catch(error){
    assertSyncSession();
    publish({status:'error',lastError:`Local sync preflight unavailable: ${error instanceof Error?error.message:String(error)}`});
    scheduleRetry();
    return 0;
  }
  assertSyncSession();
  if(unassigned>0){publish({status:'error',lastError:`${unassigned} older local change${unassigned===1?' has':'s have'} no verified account owner. Sync is paused to protect that data.`});return 0;}
  publish({status:'syncing',lastError:null,step:'Reading the local change queue'});
  let changes:PendingChange[]=[];
  try{changes=await invoke<PendingChange[]>('list_pending_sync_changes',{limit:100,expectedAccountId:accountId});assertSyncSession();}
  catch(error){const message=error instanceof Error?error.message:String(error);publish({status:'error',lastError:message});scheduleRetry();currentSyncSession=null;return 0;}
  let syncedCount=0;
  let syncSucceeded=true;
  const blockedUploads=new Set<string>();
  for(const change of changes.filter(isResourceUpload)){
    if(!withoutBlockedResources([change],blockedUploads).length){
      if(change.entity_id)blockedUploads.add(change.entity_id);
      continue;
    }
    try{
      publish({step:`Verifying upload session (${change.change_id})`});
      assertSyncSession();const context=await captureServerRequest(token);assertSyncSession();
      if(!context.nativeSessionToken)throw new Error('Native upload session unavailable');
      await transferResourceUpload(change,accountId,context.nativeSessionToken,()=>{assertSyncSession();if(!isServerRequestCurrent(context))throw new Error('Upload session changed');},step=>publish({step:`${step} (${change.change_id})`}));
    }catch(error){
      syncSucceeded=false;blockedUploads.add(change.entity_id||'');
      const message=error instanceof Error?error.message:String(error);
      assertSyncSession();
      await invoke('record_sync_failure',{changeId:change.change_id,errorMessage:message});
      publish({status:'error',lastError:`File transfer: ${message}`});scheduleRetry();
    }
  }
  // Withhold dependent edits/deletes for a file whose create is not ready;
  // independent domain changes can still synchronize in this pass.
  changes=withoutBlockedResources(changes,blockedUploads);
  if(changes.length){
    const deviceId=changes[0].device_id;
    try{
      assertSyncSession();
      publish({step:'Verifying server push session'});
      const downloadContext=await captureServerRequest(token);
      assertSyncSession();
      publish({step:'Sending saved changes to the server'});
      const response=await apiFetch('/sync/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device_id:deviceId,changes:changes.map(({change_id,entity_type,entity_id,operation,payload})=>({change_id,entity_type,entity_id,operation,payload}))})});
      assertSyncSession();
      if(response.ok){
        const body=await response.json() as {results?:SyncResult[]};
        assertSyncSession();
        publish({step:'Confirming server receipts locally'});
        const results=Array.isArray(body.results)?body.results:[];
        const outcome=await processSyncReceipts(changes,results,{
          assertSession:assertSyncSession,
          acknowledge:async(change,result)=>{
            assertSyncSession();
            if(change.entity_type==='resource'&&['attach','edit_metadata'].includes(change.operation)){
              await confirmResourceMutation(change.change_id,token,assertSyncSession);
              return;
            }
            if(isResourceUpload(change)){
              await confirmResourceChange(change.change_id,token,assertSyncSession);
              // Native receipt binding, authority cache and ACK commit together.
              return;
            }
            if(['resource_download_job','media_download_settings'].includes(change.entity_type)){
              if(!downloadContext.nativeSessionToken||!isServerRequestCurrent(downloadContext))throw new Error('Download acknowledgement session changed');
              // This native command commits the projection and ACK atomically.
              await invoke('acknowledge_local_download_changes',{expectedAccountId:accountId,expectedSessionToken:downloadContext.nativeSessionToken,results:[result]});
            }else{
              await invoke('mark_sync_changes_synced',{changeIds:[change.change_id]});
            }
          },
          reject:async(change,result)=>{
            assertSyncSession();
            await invoke('record_sync_conflict',{changeId:change.change_id,entityType:change.entity_type,entityId:change.entity_id??null,operation:change.operation,payloadJson:JSON.stringify(change.payload),errorCode:result.error?.code||'SYNC_REJECTED',errorMessage:result.error?.message||'The server rejected this offline change'});
            publish({status:'error',lastError:result.error?.message||'A change requires review'});
          },
          fail:async(change,message)=>{
            assertSyncSession();
            await invoke('record_sync_failure',{changeId:change.change_id,errorMessage:message});
            publish({status:'error',lastError:`Sync confirmation: ${message}`});
          }
        });
        syncedCount=outcome.syncedCount;
        if(outcome.failedCount)syncSucceeded=false;
        if(outcome.retry)scheduleRetry();
      }else{
        syncSucceeded=false;
        const message=await getApiErrorMessage(response,'Unable to synchronize local changes');
        for(const change of changes){assertSyncSession();await invoke('record_sync_failure',{changeId:change.change_id,errorMessage:message}).catch(()=>undefined);}
        publish({status:'error',lastError:`Sync push: ${message}`});
        scheduleRetry();
      }
    }catch(error){
      syncSucceeded=false;
      const message=error instanceof Error?error.message:String(error);
      for(const change of changes){assertSyncSession();await invoke('record_sync_failure',{changeId:change.change_id,errorMessage:message}).catch(()=>undefined);}
      publish({status:'error',lastError:`Sync push: ${message}`});
      scheduleRetry();
    }
  }
  const inventoryPullSucceeded=await runPullStep('Inventory pull',pullServerInventory);
  const notificationPullSucceeded=await runPullStep('Notifications pull',pullServerNotifications);
  const activityPullSucceeded=await runPullStep('Activity pull',pullActivitySnapshot);
  const catalogPullSucceeded=await runPullStep('Catalog pull',pullServerCatalogs);
  const maintenancePullSucceeded=await runPullStep('Maintenance pull',pullServerMaintenance);
  const preferencesPullSucceeded=await runPullStep('Preferences pull',async()=>{
    const response=await apiFetch('/system/daily-preferences',{cache:'no-store'});
    if(!response.ok)throw new Error(await getApiErrorMessage(response,'Unable to download preferences'));
    const preferences=await response.json();assertSyncSession();
    await invoke('apply_server_daily_preferences',{preferences,expectedAccountId:syncAccountId()});
    return true;
  });
  const projectPullSucceeded=await runPullStep('Project pull',pullServerProjects);
  const commentPullSucceeded=await runPullStep('Comments pull',pullServerComments);
  const resourcePullSucceeded=await runPullStep('Resource pull',pullServerResources);
  const downloadsPullSucceeded=await runPullStep('Downloads pull',pullDownloadSnapshot);
  const financePullSucceeded=await runPullStep('Finance pull',pullServerFinance);
  const locationPullSucceeded=await runPullStep('Location pull',pullServerLocations);
  const engineeringPullSucceeded=await runPullStep('Engineering pull',pullServerEngineering);
  const knowledgePullSucceeded=await runPullStep('Knowledge pull',pullServerKnowledge);
  const notesPullSucceeded=await runPullStep('Notes pull',pullServerNotes);
  // Refresh after all three scope sources: newly pulled notes need destination
  // grants in this pass, not only after a second successful synchronization.
  const authorityPullSucceeded=await runPullStep('Resource authority',async()=>{
    await refreshResourceAuthority(currentSyncSession!.token,assertSyncSession);
    return true;
  });
  const pullSucceeded=authorityPullSucceeded&&downloadsPullSucceeded&&activityPullSucceeded&&commentPullSucceeded&&notificationPullSucceeded&&catalogPullSucceeded&&inventoryPullSucceeded&&maintenancePullSucceeded&&preferencesPullSucceeded&&projectPullSucceeded&&resourcePullSucceeded&&financePullSucceeded&&locationPullSucceeded&&engineeringPullSucceeded&&knowledgePullSucceeded&&notesPullSucceeded;
  if(!pullSucceeded){syncSucceeded=false;publish({status:'error',lastError:getSyncRuntimeState().lastError||'Unable to download the latest server changes'});scheduleRetry();}
  if(syncSucceeded&&pullSucceeded){clearRetryState();publish({status:'idle',lastSuccessAt:new Date().toISOString(),lastError:null});}
  else if(getSyncRuntimeState().status!=='error')publish({status:'error',lastError:getSyncRuntimeState().lastError||'Some changes could not be synchronized'});
  currentSyncSession=null;
  return syncedCount;
}

function isCompositeCursor(cursor:string):boolean{try{const padded=cursor.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(cursor.length/4)*4,'=');const parsed=JSON.parse(atob(padded));return Boolean(parsed&&typeof parsed.at==='string'&&(parsed.type==='item'||parsed.type==='delete')&&typeof parsed.id==='string');}catch{return false;}}

async function pullServerInventory():Promise<boolean>{
  if(typeof navigator!=='undefined'&&!navigator.onLine){publish({status:'offline'});return false;}
  try{
    let cursor=await invoke<string|null>('get_inventory_sync_cursor',{expectedAccountId:syncAccountId()});
    if(cursor&&!isCompositeCursor(cursor))cursor=null;
    for(let page=0;page<100;page++){
      const query=cursor?`/sync/pull?since=${encodeURIComponent(cursor)}&limit=500`:'/sync/pull?limit=500';
      const response=await apiFetch(query,{method:'GET',cache:'no-store'});
      if(!response.ok){publish({status:'error',lastError:await getApiErrorMessage(response,'Unable to download server changes')});return false;}
      const body=await response.json() as PullResponse;
      assertSyncSession();
      const pageResult=await applyInventoryPage(body,cursor,syncAccountId());
      assertSyncSession();cursor=pageResult.cursor;
      if(pageResult.done)return true;
    }
    return false;
  }catch(error){publish({status:'error',lastError:error instanceof Error?error.message:String(error)});return false;}
}


async function pullServerProjects():Promise<boolean>{
  if(typeof navigator!=='undefined'&&!navigator.onLine){publish({status:'offline'});return false;}
  try{
    const response=await apiFetch('/sync/projects/pull',{method:'GET',cache:'no-store'});
    if(!response.ok){publish({status:'error',lastError:await getApiErrorMessage(response,'Unable to download project changes')});return false;}
    const body=await response.json() as {projects?:unknown[];visible_project_ids?:string[];deleted_project_ids?:string[];deleted_project_entities?:Record<string,string[]>};
    const deleted=body.deleted_project_entities||{};
    assertSyncSession();
    await invoke('apply_server_project_pull',{projectsJson:JSON.stringify(Array.isArray(body.projects)?body.projects:[]),visibleProjectIds:Array.isArray(body.visible_project_ids)?body.visible_project_ids:[],deletedProjectIds:Array.isArray(body.deleted_project_ids)?body.deleted_project_ids:[],deletedProjectTaskIds:Array.isArray(deleted.project_task)?deleted.project_task:[],deletedProjectExperimentIds:Array.isArray(deleted.project_experiment)?deleted.project_experiment:[],deletedProjectBomIds:Array.isArray(deleted.project_bom)?deleted.project_bom:[],deletedProjectBlockIds:Array.isArray(deleted.project_block)?deleted.project_block:[],deletedProjectConnectorIds:Array.isArray(deleted.project_connector)?deleted.project_connector:[],deletedProjectMeasurementIds:Array.isArray(deleted.project_experiment_measurement)?deleted.project_experiment_measurement:[],deletedProjectObservationIds:Array.isArray(deleted.project_experiment_observation)?deleted.project_experiment_observation:[],deletedProjectAttachmentIds:Array.isArray(deleted.project_work_attachment)?deleted.project_work_attachment:[],deletedProjectTaskExperimentIds:Array.isArray(deleted.project_task_experiment)?deleted.project_task_experiment:[],deletedProjectRequirementIds:Array.isArray(deleted.project_resource_requirement)?deleted.project_resource_requirement:[],expectedAccountId:syncAccountId()});
    return true;
  }catch(error){publish({status:'error',lastError:error instanceof Error?error.message:String(error)});return false;}
}


async function pullServerResources():Promise<boolean>{
  if(typeof navigator!=='undefined'&&!navigator.onLine){publish({status:'offline'});return false;}
  try{
    const response=await apiFetch('/sync/resources/pull',{method:'GET',cache:'no-store'});
    if(!response.ok){publish({status:'error',lastError:await getApiErrorMessage(response,'Unable to download resource changes')});return false;}
    const body=await response.json() as {resources?:Resource[];visible_resource_ids?:string[];deleted_resource_ids?:string[]};
    assertSyncSession();
    await invoke('apply_server_resource_pull',{resourcesJson:JSON.stringify(Array.isArray(body.resources)?body.resources:[]),visibleResourceIds:Array.isArray(body.visible_resource_ids)?body.visible_resource_ids:[],deletedResourceIds:Array.isArray(body.deleted_resource_ids)?body.deleted_resource_ids:[],expectedAccountId:syncAccountId()});
    window.dispatchEvent(new Event('labos-posters-updated'));
    void pullResourcePosters(body.resources||[]).catch(()=>{});
    void pullResourceFiles(body.resources||[]).catch(()=>{});
    return true;
  }catch(error){publish({status:'error',lastError:error instanceof Error?error.message:String(error)});return false;}
}


async function pullServerFinance():Promise<boolean>{if(typeof navigator!=='undefined'&&!navigator.onLine)return false;try{const response=await apiFetch('/sync/finance/pull',{method:'GET',cache:'no-store'});if(!response.ok)return false;const body=await response.json() as any;const d=body.deleted||{};assertSyncSession();await invoke('apply_server_finance_pull',{transactions:Array.isArray(body.transactions)?body.transactions:[],budgetPeriods:Array.isArray(body.budget_periods)?body.budget_periods:[],fundingSources:Array.isArray(body.funding_sources)?body.funding_sources:[],deletedTransactions:Array.isArray(d.transaction)?d.transaction:[],deletedBudgetPeriods:Array.isArray(d.budget_period)?d.budget_period:[],deletedFundingSources:Array.isArray(d.funding_source)?d.funding_source:[],snapshotComplete:body.snapshot_complete===true,sensitiveAccess:body.sensitive_access===true,expectedAccountId:syncAccountId()});return true}catch(error){publish({status:'error',lastError:error instanceof Error?error.message:String(error)});return false;}}


async function pullServerEngineering():Promise<boolean>{
  if(typeof navigator!=='undefined'&&!navigator.onLine)return false;
  try{
    const response=await apiFetch('/sync/engineering/pull',{method:'GET',cache:'no-store'});
    if(!response.ok){publish({status:'error',lastError:await getApiErrorMessage(response,'Unable to download engineering changes')});return false;}
    const body=await response.json() as EngineeringPullResponse;
    if(!Array.isArray(body.visible_calculation_ids)||!Array.isArray(body.visible_test_ids))
      throw new Error('Engineering pull omitted its visibility snapshot; local cache was not changed.');
    assertSyncSession();
    await invoke('apply_server_engineering_pull',{calculations:Array.isArray(body.calculations)?body.calculations:[],tests:Array.isArray(body.tests)?body.tests:[],visibleCalculationIds:body.visible_calculation_ids,visibleTestIds:body.visible_test_ids,deletedCalculationIds:Array.isArray(body.deleted_calculation_ids)?body.deleted_calculation_ids:[],deletedTestIds:Array.isArray(body.deleted_test_ids)?body.deleted_test_ids:[],expectedAccountId:syncAccountId()});
    return true;
  }catch(error){publish({status:'error',lastError:error instanceof Error?error.message:String(error)});return false;}
}

async function pullServerKnowledge():Promise<boolean>{
  if(typeof navigator!=='undefined'&&!navigator.onLine)return false;
  try{
    const response=await apiFetch('/knowledge/sync/pull',{method:'GET',cache:'no-store'});
    if(!response.ok){publish({status:'error',lastError:await getApiErrorMessage(response,'Unable to download knowledge changes')});return false;}
    const body=await response.json() as KnowledgePullResponse;
    if(!Array.isArray(body.visible_finding_ids)||!Array.isArray(body.visible_result_ids)||!Array.isArray(body.visible_relationship_ids))
      throw new Error('Knowledge pull omitted its visibility snapshot; local cache was not changed.');
    const deleted=body.deleted||{};
    assertSyncSession();
    await invoke('apply_server_knowledge_pull',{
      findings:Array.isArray(body.findings)?body.findings:[],
      results:Array.isArray(body.results)?body.results:[],
      relationships:Array.isArray(body.relationships)?body.relationships:[],
      visibleFindingIds:body.visible_finding_ids,
      visibleResultIds:body.visible_result_ids,
      visibleRelationshipIds:body.visible_relationship_ids,
      deletedFindingIds:Array.isArray(deleted.finding)?deleted.finding:[],
      deletedResultIds:Array.isArray(deleted.knowledge_result)?deleted.knowledge_result:[],
      deletedRelationshipIds:Array.isArray(deleted.knowledge_relationship)?deleted.knowledge_relationship:[],
      expectedAccountId:syncAccountId()
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
    assertSyncSession();
    await invoke('apply_server_notes_pull',{notes:Array.isArray(body.notes)?body.notes:[],visibleNoteIds:Array.isArray(body.visible_note_ids)?body.visible_note_ids:[],deletedNoteIds:Array.isArray(body.deleted_note_ids)?body.deleted_note_ids:[],expectedAccountId:syncAccountId()});
    return true;
  }catch(error){publish({status:'error',lastError:error instanceof Error?error.message:String(error)});return false;}
}

async function pullServerComments():Promise<boolean>{
  const response=await apiFetch('/sync/comments/pull',{cache:'no-store'});
  if(!response.ok)throw new Error(await getApiErrorMessage(response));
  const body=await response.json();assertSyncSession();
  if(body.snapshot_complete!==true||!Array.isArray(body.records)||!Array.isArray(body.visible_project_ids))throw new Error('Incomplete comment snapshot');
  await invoke('apply_server_comments_pull',{records:body.records,visibleProjectIds:body.visible_project_ids,snapshotComplete:true,expectedAccountId:syncAccountId()});return true;
}

async function pullServerNotifications():Promise<boolean>{
  const response=await apiFetch('/sync/notifications/pull',{cache:'no-store'});
  if(!response.ok)throw new Error(await getApiErrorMessage(response));
  const body=await response.json();assertSyncSession();
  if(body.snapshot_complete!==true||!Array.isArray(body.records))throw new Error('Incomplete notification snapshot');
  await invoke('apply_server_notifications_pull',{records:body.records,snapshotComplete:true,expectedAccountId:syncAccountId()});return true;
}

async function pullServerCatalogs():Promise<boolean>{
  for(const kind of ['supplier','storage_container']){
    const response=await apiFetch(`/sync/catalog/${kind}/pull`,{cache:'no-store'});
    if(!response.ok)throw new Error(await getApiErrorMessage(response,'Unable to download catalog'));
    const body=await response.json();assertSyncSession();
    if(body.snapshot_complete!==true||!Array.isArray(body.records))throw new Error('Incomplete catalog snapshot');
    await invoke('apply_server_catalog_pull',{kind,records:body.records,snapshotComplete:true,expectedAccountId:syncAccountId()});
  }return true;
}

async function pullServerMaintenance():Promise<boolean>{
  const response=await apiFetch('/sync/maintenance/pull',{cache:'no-store'});
  if(!response.ok)throw new Error(await getApiErrorMessage(response,'Unable to download maintenance records'));
  const body=await response.json();
  assertSyncSession();
  if(body.snapshot_complete!==true||!Array.isArray(body.records))throw new Error('Maintenance pull omitted its complete snapshot; cache was not changed');
  await invoke('apply_server_maintenance_pull',{records:body.records,snapshotComplete:true,expectedAccountId:syncAccountId()});
  return true;
}

async function pullServerLocations():Promise<boolean>{
  if(typeof navigator!=='undefined'&&!navigator.onLine)return false;
  try{
    const response=await apiFetch('/sync/locations/pull',{method:'GET',cache:'no-store'});
    if(!response.ok){publish({status:'error',lastError:await getApiErrorMessage(response,'Unable to download location changes')});return false;}
    const body=await response.json() as LocationPullResponse;
    assertSyncSession();
    await invoke('apply_server_location_pull',{snapshotComplete:body.snapshot_complete===true,locationsJson:JSON.stringify(Array.isArray(body.locations)?body.locations:[]),deletedLocationIds:Array.isArray(body.deleted_location_ids)?body.deleted_location_ids:[],expectedAccountId:syncAccountId()});
    return true;
  }catch(error){publish({status:'error',lastError:error instanceof Error?error.message:String(error)});return false;}
}
