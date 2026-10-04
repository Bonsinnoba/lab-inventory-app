import { apiFetch, getApiErrorMessage } from './http';
import { localBackend } from './local-backend';
import { captureAccountSession, isAccountSessionCurrent } from './auth';

type MediaPreferences={auto_pause_music:boolean;music_volume:number};
export interface DailyUsePreferences extends MediaPreferences { notifications_enabled:boolean;sync_version:number;updated_at:string|null;pending_sync:boolean;legacy_media?:MediaPreferences|null; }
type PreferencePatch=Partial<Pick<DailyUsePreferences,'notifications_enabled'|'auto_pause_music'|'music_volume'>> & {expected_version?:number};
const defaults:MediaPreferences={auto_pause_music:false,music_volume:0.7};
const notificationCache=new Map<string,Pick<DailyUsePreferences,'notifications_enabled'|'sync_version'|'updated_at'>>();
const uncertain=new Map<string,string>();
function session(){const value=captureAccountSession();if(!value)throw new Error('Sign in to use preferences');return value;}
function mediaKey(account:string){return 'labos.device-media.v1:'+account;}
function validateMedia(p:Partial<MediaPreferences>){
  if(p.auto_pause_music!==undefined&&typeof p.auto_pause_music!=='boolean')throw new Error('auto_pause_music must be boolean');
  if(p.music_volume!==undefined&&(typeof p.music_volume!=='number'||!Number.isFinite(p.music_volume)||p.music_volume<0||p.music_volume>1))throw new Error('music_volume must be between 0 and 1');
}
function readMedia(account:string):MediaPreferences{
  const raw=localStorage.getItem(mediaKey(account));if(!raw)return {...defaults};
  const parsed=JSON.parse(raw);validateMedia(parsed);return {...defaults,...parsed};
}
function notify(p:DailyUsePreferences){window.dispatchEvent(new CustomEvent('labos:daily-preferences-changed',{detail:p}));}
export async function getDailyUsePreferences():Promise<DailyUsePreferences>{
  const s=session();
  if(localBackend.isAvailable()){
    const result=await localBackend.invoke<DailyUsePreferences>('get_local_daily_use_preferences',{expectedAccountId:s.accountId});
    if(!result)throw new Error('Local preferences are unavailable; server fallback was not attempted');
    if(!isAccountSessionCurrent(s))throw new Error('Account changed while reading preferences');
    return result;
  }
  const r=await apiFetch('/system/daily-preferences',{cache:'no-store'});
  if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to load preferences'));
  const body=await r.json();
  if(!isAccountSessionCurrent(s))throw new Error('Account changed while reading preferences');
  if(typeof body.notifications_enabled!=='boolean'||!Number.isSafeInteger(body.sync_version))throw new Error('Invalid preference response');
  notificationCache.set(s.accountId,body);
  return {...body,...readMedia(s.accountId),pending_sync:false,legacy_media:localStorage.getItem(mediaKey(s.accountId))?null:body.legacy_media};
}
export async function updateDailyUsePreferences(p:PreferencePatch):Promise<DailyUsePreferences>{
  const s=session();validateMedia(p);
  if(p.notifications_enabled!==undefined&&typeof p.notifications_enabled!=='boolean')throw new Error('notifications_enabled must be boolean');
  if(localBackend.isAvailable()){
    const result=await localBackend.invoke<DailyUsePreferences>('update_local_daily_use_preferences',{preferences:p,expectedAccountId:s.accountId});
    if(!result)throw new Error('Local preference write returned no result; server fallback was not attempted');
    if(!isAccountSessionCurrent(s))throw new Error('Account changed while saving preferences');
    notify(result);return result;
  }
  let remote=notificationCache.get(s.accountId)??{notifications_enabled:true,sync_version:0,updated_at:null};
  if(p.notifications_enabled!==undefined){
    if(!Number.isSafeInteger(p.expected_version))throw new Error('Refresh notification preferences before changing them');
    const body={notifications_enabled:p.notifications_enabled,expected_version:p.expected_version};
    const signature=JSON.stringify([s.accountId,body]);
    let key=uncertain.get(signature);if(!key){key=crypto.randomUUID();uncertain.set(signature,key);}
    const r=await apiFetch('/system/daily-preferences',{method:'PATCH',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
    if(!r.ok){if(r.status>=400&&r.status<500)uncertain.delete(signature);throw new Error(await getApiErrorMessage(r,'Unable to save notification preference'));}
    remote=await r.json();uncertain.delete(signature);
    if(!isAccountSessionCurrent(s))throw new Error('Account changed while saving preferences');
    notificationCache.set(s.accountId,remote);
  }
  if(!isAccountSessionCurrent(s))throw new Error('Account changed while saving preferences');
  const media=readMedia(s.accountId);
  if(p.auto_pause_music!==undefined)media.auto_pause_music=p.auto_pause_music;
  if(p.music_volume!==undefined)media.music_volume=p.music_volume;
  // Device-only writes require no network; errors do not fall back to the server.
  if(p.auto_pause_music!==undefined||p.music_volume!==undefined)localStorage.setItem(mediaKey(s.accountId),JSON.stringify(media));
  const result={...remote,...media,pending_sync:false};notify(result);return result;
}
export async function importLegacyMediaPreferences():Promise<DailyUsePreferences>{
  const s=session();
  if(localBackend.isAvailable())throw new Error('Desktop settings are already preserved on this installation');
  if(localStorage.getItem(mediaKey(s.accountId)))throw new Error('This device already has music settings; nothing was overwritten');
  const prefs=await getDailyUsePreferences();
  if(!prefs.legacy_media)throw new Error('No historical music settings are available');
  if(!isAccountSessionCurrent(s)||localStorage.getItem(mediaKey(s.accountId)))throw new Error('Settings changed during import; nothing was overwritten');
  return updateDailyUsePreferences(prefs.legacy_media);
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
