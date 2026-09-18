import { apiFetch, getApiErrorMessage } from './http';
import { invoke } from '@tauri-apps/api/tauri';

const isTauriRuntime = () => typeof window !== 'undefined' && Boolean((window as any).__TAURI_IPC__);

export interface DailyUsePreferences { notifications_enabled: boolean; auto_pause_music: boolean; music_volume: number; updated_at: string; }

export async function getDailyUsePreferences(): Promise<DailyUsePreferences> {
  if (isTauriRuntime()) {
    try { return await invoke<DailyUsePreferences>('get_local_daily_use_preferences'); } catch { /* use central fallback for older runtimes */ }
  }
  const r = await apiFetch('/system/daily-preferences');
  if (!r.ok) throw new Error(await getApiErrorMessage(r,'Failed to load daily-use preferences'));
  return r.json();
}

export async function updateDailyUsePreferences(p: Partial<DailyUsePreferences>): Promise<DailyUsePreferences> {
  if (isTauriRuntime()) {
    try { return await invoke<DailyUsePreferences>('update_local_daily_use_preferences', { preferences: p }); } catch { /* use central fallback for older runtimes */ }
  }
  const r = await apiFetch('/system/daily-preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});
  if (!r.ok) throw new Error(await getApiErrorMessage(r,'Failed to save daily-use preferences'));
  return r.json();
}

export async function getSystemHealth(): Promise<any> {
  const r=await apiFetch('/system/health-details'); const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data?.error||'System health check failed'); return data;
}

export async function downloadLabosExport(): Promise<void> {
  const r=await apiFetch('/system/export');
  if(!r.ok) throw new Error(await getApiErrorMessage(r,'Export is available to administrators only'));
  const blob=await r.blob(); const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download=`labos-export-${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
