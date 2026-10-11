import { apiFetch, apiUrl, getApiErrorMessage } from './http';
import { getToken } from './auth';
import { isTauriRuntime } from '../lib/runtime';
import {readDownloadSnapshot,enqueueLocalDownload,saveLocalDownloadSettings,downloadSettingsPatch,controlLocalDownload,type DownloadAction} from './downloads-local';
import { captureAccountSession,isAccountSessionCurrent } from './auth';
export {readDownloadSnapshot} from './downloads-local';

export interface DownloadJob {
  id: string; resource_id: string; resource_name: string; resource_url?: string; thumbnail_url?: string;
  local_media_filename?: string; local_media_size_bytes?: number;
  status: 'queued'|'scheduled'|'downloading'|'paused'|'completed'|'failed'|'cancelled';
  quality: string; scheduled_for?: string|null; priority: number; progress: number;
  bytes_downloaded?: number; total_bytes?: number; error_message?: string; attempts: number; max_attempts?: number;
  cancel_requested?: boolean; stop_requested_status?: 'paused'|'cancelled'|null;
  started_at?: string; process_started_at?: string; last_progress_at?: string; completed_at?: string; created_at: string; updated_at?: string;
  control_version?:number; pending_action?:DownloadAction; requested_patch?:Record<string,unknown>; sync_error?:string; control_outcome?:'already_completed';
  sync_state?:'pending_sync'|'conflict'|'server';
}
export interface DownloadSettings { enabled: boolean; mode: 'manual'|'scheduled'|'always'; window_start: string; window_end: string; concurrent_downloads: number; default_quality: string; max_retries: number; sync_version:number; pending_sync?:boolean; sync_conflict?:boolean; }
export interface MediaToolStatus { available: boolean; path: string; error?: string; }
export interface MediaToolsStatus { yt_dlp: MediaToolStatus; ffmpeg: MediaToolStatus; node: MediaToolStatus; production: boolean; }
export type DownloadQuality = 'best'|'1080p'|'720p'|'480p';

export function getLocalMediaUrl(id: string) { const token=getToken(); return apiUrl(`/media-downloads/${id}/media${token ? `?access_token=${encodeURIComponent(token)}` : ''}`); }
export function getLocalThumbnailUrl(id: string) { const token=getToken(); return apiUrl(`/media-downloads/${id}/thumbnail${token ? `?access_token=${encodeURIComponent(token)}` : ''}`); }
export async function getDownloadJobs(): Promise<DownloadJob[]> {
  if(isTauriRuntime()){const snapshot=await readDownloadSnapshot();if(!snapshot.snapshot_complete&&!snapshot.jobs.length)throw new Error('Download queue has not been synchronized to this PC');return snapshot.jobs;}
  const r=await apiFetch('/media-downloads/queue');if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to fetch download queue'));return r.json();
}
export async function queueVideoDownload(resource_id:string, quality?:DownloadQuality, scheduled_for?:string):Promise<DownloadJob>{
  if(isTauriRuntime())return enqueueLocalDownload(resource_id,quality,scheduled_for);
  const r=await apiFetch('/media-downloads/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource_id,quality,scheduled_for})});
  if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to queue video download'));return r.json();
}
export type DownloadEdits=Partial<Pick<DownloadJob,'status'|'quality'|'scheduled_for'|'priority'>>;
const uncertainControls=new Map<string,string>();
async function controlDownload(job:DownloadJob,action:DownloadAction,patch:Record<string,unknown>={}):Promise<DownloadJob>{
  if(isTauriRuntime())return controlLocalDownload(job,action,patch);
  const session=captureAccountSession();if(!session)throw new Error('Sign in before changing downloads');
  if(!Number.isSafeInteger(job.control_version))throw new Error('Refresh the download before changing it');
  const payload={resource_id:job.resource_id,expected_version:job.control_version,action,patch};
  const signature=JSON.stringify([session.accountId,job.id,payload]);
  let key=uncertainControls.get(signature);if(!key){key=crypto.randomUUID();uncertainControls.set(signature,key);}
  const r=await apiFetch(`/media-downloads/queue/${job.id}${action==='start'?'/start':''}`,{
    method:action==='remove'?'DELETE':action==='start'?'POST':'PATCH',
    headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(payload)});
  if(!r.ok){if(r.status>=400&&r.status<500)uncertainControls.delete(signature);throw new Error(await getApiErrorMessage(r,'Unable to save download action'));}
  const result=await r.json();uncertainControls.delete(signature);
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while saving download action');return result;
}
export async function updateDownloadJob(job:DownloadJob,changes:DownloadEdits):Promise<DownloadJob>{
  if(changes.status==='paused'||changes.status==='cancelled')return controlDownload(job,changes.status==='paused'?'pause':'cancel');
  return controlDownload(job,'edit',changes);
}
export async function startDownloadJob(job:DownloadJob):Promise<DownloadJob>{return controlDownload(job,'start');}
export async function cancelDownloadJob(job:DownloadJob):Promise<DownloadJob>{return controlDownload(job,'cancel');}
export async function removeDownloadJob(job:DownloadJob){return controlDownload(job,'remove');}
export async function getDownloadSettings():Promise<DownloadSettings>{
  if(isTauriRuntime()){const snapshot=await readDownloadSnapshot();if(!snapshot.settings)throw new Error('Download settings have not been synchronized to this PC');return snapshot.settings;}
  const r=await apiFetch('/media-downloads/settings');if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to fetch download settings'));return r.json();
}
const uncertainSettings=new Map<string,string>();
export async function saveDownloadSettings(settings:Partial<DownloadSettings>):Promise<DownloadSettings>{
  if(isTauriRuntime())return saveLocalDownloadSettings(settings);
  const session=captureAccountSession();if(!session)throw new Error('Sign in before saving settings');
  if(!Number.isSafeInteger(settings.sync_version))throw new Error('Refresh download settings before saving');
  const payload={patch:downloadSettingsPatch(settings),expected_version:settings.sync_version};
  const signature=JSON.stringify([session.accountId,payload]);let key=uncertainSettings.get(signature);if(!key){key=crypto.randomUUID();uncertainSettings.set(signature,key);}
  const r=await apiFetch('/media-downloads/settings',{method:'PUT',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(payload)});
  if(!r.ok){if(r.status>=400&&r.status<500)uncertainSettings.delete(signature);throw new Error(await getApiErrorMessage(r,'Failed to save download settings'));}
  const result=await r.json();uncertainSettings.delete(signature);if(!isAccountSessionCurrent(session))throw new Error('Account changed while saving settings');return result;
}
export async function getMediaToolsStatus():Promise<MediaToolsStatus>{const r=await apiFetch('/media-downloads/tools/status');if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to inspect media tools'));return r.json();}
export async function downloadYouTubeThumbnail(id:string){const r=await apiFetch(`/media-downloads/${id}/thumbnail`,{method:'POST'});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to download thumbnail'));return r.json();}
