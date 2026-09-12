import { apiFetch, apiUrl, getApiErrorMessage } from './http';
import { getToken } from './auth';

export interface DownloadJob {
  id: string; resource_id: string; resource_name: string; resource_url?: string; thumbnail_url?: string;
  local_media_filename?: string; local_media_size_bytes?: number;
  status: 'queued'|'scheduled'|'downloading'|'paused'|'completed'|'failed'|'cancelled';
  quality: string; scheduled_for?: string; priority: number; progress: number;
  bytes_downloaded?: number; total_bytes?: number; error_message?: string; attempts: number; max_attempts?: number;
  cancel_requested?: boolean; stop_requested_status?: 'paused'|'cancelled'|null;
  started_at?: string; process_started_at?: string; last_progress_at?: string; completed_at?: string; created_at: string; updated_at?: string;
}
export interface DownloadSettings { enabled: boolean; mode: 'manual'|'scheduled'|'always'; window_start: string; window_end: string; concurrent_downloads: number; default_quality: string; max_retries: number; }
export type DownloadQuality = 'best'|'1080p'|'720p'|'480p';

export function getLocalMediaUrl(id: string) { const token=getToken(); return apiUrl(`/media-downloads/${id}/media${token ? `?access_token=${encodeURIComponent(token)}` : ''}`); }
export function getLocalThumbnailUrl(id: string) { const token=getToken(); return apiUrl(`/media-downloads/${id}/thumbnail${token ? `?access_token=${encodeURIComponent(token)}` : ''}`); }
export async function getDownloadJobs(): Promise<DownloadJob[]> { const r=await apiFetch('/media-downloads/queue'); if(!r.ok) throw new Error(await getApiErrorMessage(r,'Failed to fetch download queue')); return r.json(); }
export async function queueVideoDownload(resource_id:string, quality?:DownloadQuality, scheduled_for?:string):Promise<DownloadJob>{ const r=await apiFetch('/media-downloads/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({resource_id,quality,scheduled_for})});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to queue video download'));return r.json(); }
export async function updateDownloadJob(id:string, changes:Partial<Pick<DownloadJob,'status'|'quality'|'scheduled_for'|'priority'>>):Promise<DownloadJob>{ const r=await apiFetch(`/media-downloads/queue/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(changes)});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to update download job'));return r.json(); }
export async function startDownloadJob(id:string):Promise<DownloadJob>{const r=await apiFetch(`/media-downloads/queue/${id}/start`,{method:'POST'});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to start download'));return r.json();}
export async function cancelDownloadJob(id:string):Promise<DownloadJob>{const r=await apiFetch(`/media-downloads/queue/${id}/cancel`,{method:'POST'});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to cancel download'));return r.json();}
export async function removeDownloadJob(id:string){ const r=await apiFetch(`/media-downloads/queue/${id}`,{method:'DELETE'}); if(!r.ok) throw new Error(await getApiErrorMessage(r,'Failed to remove download job')); }
export async function getDownloadSettings():Promise<DownloadSettings>{const r=await apiFetch('/media-downloads/settings');if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to fetch download settings'));return r.json();}
export async function saveDownloadSettings(settings:Partial<DownloadSettings>):Promise<DownloadSettings>{const r=await apiFetch('/media-downloads/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to save download settings'));return r.json();}
export async function downloadYouTubeThumbnail(id:string){const r=await apiFetch(`/media-downloads/${id}/thumbnail`,{method:'POST'});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to download thumbnail'));return r.json();}
