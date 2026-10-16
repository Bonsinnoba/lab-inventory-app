import { localBackend } from './local-backend';
import { captureAccountSession,isAccountSessionCurrent,captureServerRequest,isServerRequestCurrent,getToken } from './auth';
import { apiFetch } from './http';
import { downloadFailureMessage } from './download-presentation';
import type { DownloadJob,DownloadSettings,DownloadQuality,MediaToolsStatus } from './mediaDownloads';
import type { Resource } from './resources';
export interface DownloadSnapshot {jobs:DownloadJob[];settings:DownloadSettings|null;snapshot_complete:boolean;last_synced_at:string|null;pending_removal_count?:number;tools_status?:MediaToolsStatus|null;resource_links?:Resource[];}
function session(){const s=captureAccountSession();if(!s)throw new Error('Sign in to use downloads');return s;}
export async function readDownloadSnapshot():Promise<DownloadSnapshot>{
  const s=session();let value:DownloadSnapshot;
  try{value=await localBackend.invoke<DownloadSnapshot>('get_local_download_snapshot',{expectedAccountId:s.accountId});}
  catch(error){throw new Error(downloadFailureMessage(error,'Unable to read the local download snapshot'));}
  if(!isAccountSessionCurrent(s))throw new Error('Account changed while reading downloads');
  if(!value||!Array.isArray(value.jobs)||typeof value.snapshot_complete!=='boolean')throw new Error('Invalid local download snapshot');return value;
}
export async function enqueueLocalDownload(resourceId:string,quality?:DownloadQuality,scheduledFor?:string):Promise<DownloadJob>{
  const s=session();const result=await localBackend.invoke<DownloadJob>('queue_local_download',{expectedAccountId:s.accountId,resourceId,quality:quality??null,scheduledFor:scheduledFor??null});
  if(!isAccountSessionCurrent(s))throw new Error('Account changed while queuing download');return result;
}
export type DownloadAction='edit'|'start'|'pause'|'cancel'|'remove';
export async function controlLocalDownload(job:DownloadJob,action:DownloadAction,patch:Record<string,unknown>={}):Promise<DownloadJob>{
  const s=session();
  if(!Number.isSafeInteger(job.control_version))throw new Error('Synchronize and refresh the download before changing it');
  const result=await localBackend.invoke<DownloadJob>('control_local_download',{expectedAccountId:s.accountId,jobId:job.id,expectedVersion:job.control_version,action,patch});
  if(!isAccountSessionCurrent(s))throw new Error('Account changed while saving download action');return result;
}
export const downloadSettingFields=['enabled','mode','window_start','window_end','concurrent_downloads','default_quality','max_retries'] as const;
export function downloadSettingsPatch(settings:Partial<DownloadSettings>){return Object.fromEntries(downloadSettingFields.filter(key=>settings[key]!==undefined).map(key=>[key,settings[key]]));}
export async function saveLocalDownloadSettings(settings:Partial<DownloadSettings>):Promise<DownloadSettings>{
  const s=session();
  if(!Number.isSafeInteger(settings.sync_version))throw new Error('Refresh download settings before saving');
  const result=await localBackend.invoke<DownloadSettings>('save_local_download_settings',{expectedAccountId:s.accountId,patch:downloadSettingsPatch(settings),expectedVersion:settings.sync_version});
  if(!isAccountSessionCurrent(s))throw new Error('Account changed while saving download settings');return result;
}
export async function pullDownloadSnapshot():Promise<boolean>{
  const token=getToken();if(!token||token.startsWith('local:'))throw new Error('Reconnect to synchronize downloads');
  const context=await captureServerRequest(token);
  const check=()=>{if(!context.accountId||!context.nativeSessionToken||!isServerRequestCurrent(context))throw new Error('Session changed while synchronizing downloads');};check();
  const response=await apiFetch('/media-downloads/snapshot',{cache:'no-store'});check();const body=await response.json();check();
  const denied=response.status===403&&body?.error?.code==='PERMISSION_DENIED';
  if(!response.ok&&!denied)throw new Error('Unable to synchronize downloads');
  await localBackend.invoke('apply_server_download_snapshot',{expectedAccountId:context.accountId,expectedSessionToken:context.nativeSessionToken,snapshot:denied?null:body});check();return true;
}
