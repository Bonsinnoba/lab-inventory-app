import { useEffect, useState } from 'react';
import { Download, HeartPulse, Bell, Music2, ShieldCheck, CheckCircle2, RefreshCw } from 'lucide-react';
import { downloadLabosExport, getDailyUsePreferences, getSystemHealth, updateDailyUsePreferences } from '../api/system';
import { useToast } from '../contexts/ToastContext';
import { getStoredUser } from '../api/auth';

export default function DailyUsePanel(){
  const {showToast}=useToast();
  const user=getStoredUser();
  const [p,setP]=useState({notifications_enabled:true,auto_pause_music:true,music_volume:.65});
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState<string|null>(null);
  const [health,setHealth]=useState<any>(null);
  const [checking,setChecking]=useState(false);
  const [exporting,setExporting]=useState(false);

  useEffect(()=>{getDailyUsePreferences().then(setP).catch(e=>showToast(e instanceof Error?e.message:'Failed to load preferences','error')).finally(()=>setLoading(false));},[]);
  const save=async(k:string,v:any)=>{const next={...p,[k]:v};setP(next);setSaving(k);try{setP(await updateDailyUsePreferences(next));}catch(e){showToast(e instanceof Error?e.message:'Failed to save preference','error');}finally{setSaving(null);}};
  const healthCheck=async()=>{setChecking(true);try{setHealth(await getSystemHealth());}catch(e){setHealth({status:'degraded',checks:{},error:e instanceof Error?e.message:'Health check failed'});}finally{setChecking(false);}};
  const exportData=async()=>{setExporting(true);try{await downloadLabosExport();showToast('LabOS export downloaded');}catch(e){showToast(e instanceof Error?e.message:'Export failed','error');}finally{setExporting(false);}};
  const enabledChecks=Object.entries(health?.checks||{}).filter(([,v])=>v).length;
  return <div className="p-6 max-w-4xl mx-auto space-y-6">
    <header><div className="page-kicker">LABOS / DAILY USE</div><h2 className="text-page-title font-ui font-semibold mt-1">Daily Use & System</h2><p className="text-sm text-text-secondary mt-2 max-w-2xl">Voice, notifications, automation, local media, export, and operational health controls.</p></header>
    <section className="bg-surface border border-border rounded-md overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between"><div><h3 className="font-semibold">Daily preferences</h3><p className="text-xs text-text-secondary mt-1">These settings apply to your LabOS workspace.</p></div>{loading&&<span className="text-xs text-text-secondary">Loading…</span>}</div>
      <div className="divide-y divide-border">
        <label className="flex items-center justify-between gap-4 px-5 py-4 text-sm hover:bg-surface-raised/40"><span><span className="flex items-center gap-2 font-medium"><Bell size={16}/>Notifications</span><span className="block text-xs text-text-secondary mt-1 ml-6">Enable LabOS notification delivery.</span></span><span className="flex items-center gap-2"><input type="checkbox" disabled={loading||saving==='notifications_enabled'} checked={p.notifications_enabled} onChange={e=>save('notifications_enabled',e.target.checked)}/>{saving==='notifications_enabled'&&<span className="text-[11px] text-text-secondary">Saving…</span>}</span></label>
        <label className="flex items-center justify-between gap-4 px-5 py-4 text-sm hover:bg-surface-raised/40"><span><span className="flex items-center gap-2 font-medium"><Music2 size={16}/>Pause music for Lab media / TTS</span><span className="block text-xs text-text-secondary mt-1 ml-6">Temporarily pauses playback while voice or media is active.</span></span><span className="flex items-center gap-2"><input type="checkbox" disabled={loading||saving==='auto_pause_music'} checked={p.auto_pause_music} onChange={e=>save('auto_pause_music',e.target.checked)}/>{saving==='auto_pause_music'&&<span className="text-[11px] text-text-secondary">Saving…</span>}</span></label>
        <div className="px-5 py-4"><div className="flex items-center justify-between gap-4 mb-2"><span><span className="flex items-center gap-2 text-sm font-medium"><Music2 size={16}/>Default music volume</span><span className="block text-xs text-text-secondary mt-1">Volume used when the music player starts.</span></span><span className="text-xs font-mono text-text-secondary">{Math.round(p.music_volume*100)}%</span></div><input disabled={loading||saving==='music_volume'} className="w-full accent-[var(--accent)]" type="range" min="0" max="1" step=".01" value={p.music_volume} onChange={e=>save('music_volume',Number(e.target.value))}/></div>
      </div>
    </section>
    <section className="bg-surface border border-border rounded-md overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between"><div><h3 className="font-semibold flex items-center gap-2"><HeartPulse size={17}/>System health</h3><p className="text-xs text-text-secondary mt-1">Check the operational services used by this desktop app.</p></div><button type="button" onClick={healthCheck} disabled={checking} className="inline-flex items-center gap-2 px-3 py-2 bg-accent text-bg rounded-sm text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">{checking?<RefreshCw size={15} className="animate-spin"/>:<HeartPulse size={15}/>} {checking?'Checking…':'Run health check'}</button></div>
      <div className="p-5">{!health?<div className="text-sm text-text-secondary">No health check has been run yet.</div>:<div className="flex items-center justify-between gap-4"><div className="flex items-center gap-2 text-sm">{health.status==='ok'?<CheckCircle2 className="text-status-ok" size={17}/>:<ShieldCheck size={17}/>}<span className="capitalize">{health.status}</span><span className="text-text-secondary">· {enabledChecks}/{Object.keys(health.checks||{}).length} checks passing</span></div>{health.error&&<span className="text-xs text-status-danger">{health.error}</span>}</div>}</div>
    </section>
    <section className="bg-surface border border-border rounded-md overflow-hidden">
      <div className="px-5 py-4 border-b border-border"><h3 className="font-semibold">Backup & export</h3><p className="text-xs text-text-secondary mt-1">Export a complete JSON snapshot of the LabOS database. Local music is intentionally excluded.</p></div>
      <div className="p-5 flex items-center justify-between gap-4"><div>{user?.role==='admin'?<div className="text-xs text-text-secondary">Administrator export access is enabled for this account.</div>:<div className="text-xs text-text-secondary">Administrator access is required for a full database export.</div>}</div><button type="button" disabled={user?.role!=='admin'||exporting} onClick={exportData} className="inline-flex items-center gap-2 px-3 py-2 bg-accent text-bg rounded-sm text-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">{exporting?<RefreshCw size={15} className="animate-spin"/>:<Download size={16}/>} {exporting?'Preparing…':'Export LabOS JSON'}</button></div>
    </section>
  </div>;
}
