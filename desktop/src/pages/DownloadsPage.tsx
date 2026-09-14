import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CalendarClock, CheckCircle2, Clock3, Download, Film, HardDrive, Pause, Play, RefreshCw, Save, Settings2, Trash2, X } from 'lucide-react';
import { getDownloadJobs, getDownloadSettings, getMediaToolsStatus, getLocalThumbnailUrl, saveDownloadSettings, updateDownloadJob, startDownloadJob, removeDownloadJob, type DownloadJob, type DownloadSettings, type DownloadQuality } from '../api/mediaDownloads';
import { useToast } from '../contexts/ToastContext';

const qualities: DownloadQuality[] = ['720p', '1080p', '480p', 'best'];
const toDateTimeLocal = (value?: string) => { if (!value) return ''; const d = new Date(value); const pad = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fromDateTimeLocal = (value: string) => value ? new Date(value).toISOString() : undefined;
const thumbnailSrc = (url: string | undefined, id: string) => url ? (url.startsWith('/api/') ? getLocalThumbnailUrl(id) : url) : '';
const controlClass = 'bg-surface-raised border border-border rounded-sm px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent disabled:opacity-50';
const iconButtonClass = 'p-2 border border-border rounded-sm hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50 disabled:cursor-not-allowed';

function Metric({ label, value, detail }: { label: string; value: number | string; detail?: string }) {
  return <div className="bg-surface border border-border rounded-md p-4"><div className="text-xs uppercase tracking-wide text-text-secondary">{label}</div><div className="text-2xl font-semibold mt-1">{value}</div>{detail && <div className="text-xs text-text-secondary mt-1">{detail}</div>}</div>;
}

function SectionHeader({ icon, title, detail, action }: { icon: React.ReactNode; title: string; detail?: string; action?: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 mb-3"><div className="flex items-start gap-2.5 min-w-0"><div className="mt-0.5 text-text-secondary">{icon}</div><div className="min-w-0"><h3 className="font-semibold">{title}</h3>{detail && <p className="text-xs text-text-secondary mt-0.5">{detail}</p>}</div></div>{action}</div>;
}

function LoadingRows() {
  return <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-20 rounded-md border border-border bg-surface animate-pulse" />)}</div>;
}

export default function DownloadsPage() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const jobs = useQuery({ queryKey: ['media-downloads', 'queue'], queryFn: getDownloadJobs, refetchInterval: 5000 });
  const settings = useQuery({ queryKey: ['media-downloads', 'settings'], queryFn: getDownloadSettings });
  const tools = useQuery({ queryKey: ['media-downloads', 'tools'], queryFn: getMediaToolsStatus, refetchInterval: 30000 });
  const [form, setForm] = useState<DownloadSettings | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ quality: DownloadQuality; scheduled_for: string; priority: number }>({ quality: '720p', scheduled_for: '', priority: 0 });

  useEffect(() => { if (settings.data) setForm(settings.data); }, [settings.data]);

  const save = useMutation({ mutationFn: () => saveDownloadSettings(form || {}), onSuccess: d => { setForm(d); qc.invalidateQueries({ queryKey: ['media-downloads', 'settings'] }); showToast('Download settings saved'); }, onError: (e: any) => showToast(e?.message || 'Failed to save settings', 'error') });
  const change = useMutation({ mutationFn: ({ id, changes }: { id: string; changes: Partial<Pick<DownloadJob, 'status' | 'quality' | 'scheduled_for' | 'priority'>> }) => updateDownloadJob(id, changes), onSuccess: () => { setEditing(null); qc.invalidateQueries({ queryKey: ['media-downloads', 'queue'] }); }, onError: (e: any) => showToast(e?.message || 'Failed to update download', 'error') });
  const start = useMutation({ mutationFn: startDownloadJob, onSuccess: () => qc.invalidateQueries({ queryKey: ['media-downloads', 'queue'] }), onError: (e: any) => showToast(e?.message || 'Failed to start download', 'error') });
  const remove = useMutation({ mutationFn: removeDownloadJob, onSuccess: () => qc.invalidateQueries({ queryKey: ['media-downloads', 'queue'] }), onError: (e: any) => showToast(e?.message || 'Failed to remove download', 'error') });

  const active = (jobs.data || []).filter(j => ['queued', 'scheduled', 'downloading', 'paused'].includes(j.status));
  const history = (jobs.data || []).filter(j => !active.includes(j));
  const completed = history.filter(j => j.status === 'completed');
  const failed = history.filter(j => j.status === 'failed');
  const availableTools = tools.data ? [tools.data.yt_dlp, tools.data.ffmpeg, tools.data.node].filter(Boolean).filter(t => t.available).length : 0;
  const formatBytes = (n?: number) => n == null ? '—' : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  const beginEdit = (j: DownloadJob) => { setEditing(j.id); setDraft({ quality: (qualities.includes(j.quality as DownloadQuality) ? j.quality : '720p') as DownloadQuality, scheduled_for: toDateTimeLocal(j.scheduled_for), priority: j.priority || 0 }); };
  const saveJob = (j: DownloadJob) => change.mutate({ id: j.id, changes: { quality: draft.quality, scheduled_for: fromDateTimeLocal(draft.scheduled_for), priority: draft.priority, status: draft.scheduled_for ? 'scheduled' : 'queued' } });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['media-downloads', 'queue'] }); qc.invalidateQueries({ queryKey: ['media-downloads', 'settings'] }); qc.invalidateQueries({ queryKey: ['media-downloads', 'tools'] }); };

  if (settings.isPending && !form) return <div className="p-6 max-w-[1200px] mx-auto space-y-4"><div className="h-4 w-20 bg-surface-raised rounded animate-pulse" /><div className="h-10 w-56 bg-surface-raised rounded animate-pulse" /><div className="h-24 bg-surface border border-border rounded-md animate-pulse" /><LoadingRows /></div>;
  if (settings.isError && !form) return <div className="p-6 max-w-[1200px] mx-auto"><div className="border border-border bg-surface rounded-md p-8 text-center"><AlertCircle className="mx-auto mb-3 text-text-secondary" size={24}/><h2 className="font-semibold">Downloads could not be loaded</h2><p className="text-sm text-text-secondary mt-1">The download settings are unavailable right now.</p><button onClick={() => settings.refetch()} className="mt-4 px-3 py-1.5 border border-border rounded-sm text-sm hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/40">Try again</button></div></div>;
  if (!form) return null;

  const toolRows = tools.data ? [['yt-dlp', tools.data.yt_dlp], ['FFmpeg', tools.data.ffmpeg], ['Node.js', tools.data.node]] as const : [];
  return <div className="p-6 max-w-[1200px] mx-auto space-y-6">
    <header className="flex items-start justify-between gap-4">
      <div><div className="text-xs uppercase tracking-[0.16em] text-text-secondary">Media operations</div><h2 className="text-page-title font-ui font-semibold mt-1">Downloads</h2><p className="text-sm text-text-secondary mt-1 max-w-2xl">Control bandwidth, queue video work, and review completed downloads. Adding a video only queues it; the scheduler controls when network traffic starts.</p></div>
      <button onClick={refresh} disabled={jobs.isFetching || settings.isFetching || tools.isFetching} className="shrink-0 flex items-center gap-2 px-3 py-2 border border-border rounded-sm text-sm hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"><RefreshCw size={15} className={(jobs.isFetching || settings.isFetching || tools.isFetching) ? 'animate-spin' : ''}/>{(jobs.isFetching || settings.isFetching || tools.isFetching) ? 'Refreshing…' : 'Refresh'}</button>
    </header>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3"><Metric label="Queued" value={active.length} detail="Waiting or downloading"/><Metric label="Completed" value={completed.length} detail="Finished successfully"/><Metric label="Needs attention" value={failed.length} detail="Failed downloads"/><Metric label="Media tools" value={tools.isError ? '—' : `${availableTools}/3`} detail="Available to worker"/></div>

    <section className="bg-surface border border-border rounded-md p-4">
      <SectionHeader icon={<Settings2 size={17}/>} title="Download schedule" detail="Global defaults apply unless a queued job has its own schedule." action={<button onClick={() => save.mutate()} disabled={save.isPending} className="flex items-center gap-2 px-3 py-1.5 bg-accent text-bg rounded-sm text-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"><Save size={15}/>{save.isPending ? 'Saving…' : 'Save settings'}</button>}/>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <label className="text-xs text-text-secondary">Mode<select aria-label="Download mode" value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value as DownloadSettings['mode'] })} className={`mt-1 w-full ${controlClass}`}><option value="scheduled">Scheduled</option><option value="manual">Manual</option><option value="always">Always allowed</option></select></label>
        <label className="text-xs text-text-secondary">Start<input aria-label="Download window start" type="time" value={form.window_start} onChange={e => setForm({ ...form, window_start: e.target.value })} disabled={form.mode !== 'scheduled'} className={`mt-1 w-full ${controlClass}`}/></label>
        <label className="text-xs text-text-secondary">End<input aria-label="Download window end" type="time" value={form.window_end} onChange={e => setForm({ ...form, window_end: e.target.value })} disabled={form.mode !== 'scheduled'} className={`mt-1 w-full ${controlClass}`}/></label>
        <label className="text-xs text-text-secondary">Default quality<select aria-label="Default download quality" value={form.default_quality} onChange={e => setForm({ ...form, default_quality: e.target.value })} className={`mt-1 w-full ${controlClass}`}>{qualities.map(q => <option key={q}>{q}</option>)}</select></label>
        <label className="text-xs text-text-secondary">Concurrent<input aria-label="Concurrent downloads" type="number" min={1} max={3} value={form.concurrent_downloads} onChange={e => setForm({ ...form, concurrent_downloads: Math.max(1, Math.min(3, Number(e.target.value) || 1)) })} className={`mt-1 w-full ${controlClass}`}/></label>
      </div>
      <label className="flex items-center gap-2 mt-3 text-sm"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} className="accent-accent"/>Enable download worker</label>
    </section>

    <section className="bg-surface border border-border rounded-md p-4">
      <SectionHeader icon={<CheckCircle2 size={17}/>} title="Download system" detail="Tool availability used by the background worker." action={tools.isFetching ? <span className="text-xs text-text-secondary">Checking…</span> : undefined}/>
      {tools.isError ? <div className="rounded-sm border border-border bg-surface-raised p-3 text-sm text-text-secondary flex items-start gap-2"><AlertCircle size={16} className="mt-0.5 shrink-0"/>Unable to inspect media tools. <button onClick={() => tools.refetch()} className="underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-accent/40 rounded-sm">Try again</button></div> : <div className="grid grid-cols-1 md:grid-cols-3 gap-2">{toolRows.map(([name, tool]) => <div key={name} className="rounded-sm border border-border bg-surface-raised p-3"><div className="flex items-center justify-between"><span className="text-sm font-medium">{name}</span>{tool.available ? <CheckCircle2 size={16}/> : <AlertCircle size={16}/>}</div><div className="text-xs text-text-secondary mt-1 break-all">{tool.available ? tool.path : tool.error || 'Unavailable'}</div></div>)}</div>}
    </section>

    <section>
      <SectionHeader icon={<Download size={17}/>} title="Queue" detail={jobs.isFetching ? 'Updating every few seconds' : 'Active and scheduled download work'} action={<span className="text-xs text-text-secondary">{active.length} active</span>}/>
      {jobs.isError ? <div className="border border-border bg-surface rounded-md p-6 text-center text-sm"><AlertCircle className="mx-auto mb-2 text-text-secondary" size={20}/><p>Unable to load the download queue.</p><button onClick={() => jobs.refetch()} className="mt-3 px-3 py-1.5 border border-border rounded-sm hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/40">Try again</button></div> : jobs.isPending ? <LoadingRows/> : active.length === 0 ? <div className="border border-dashed border-border rounded-md p-8 text-center text-sm text-text-secondary"><Download className="mx-auto mb-2 opacity-60" size={20}/><p>No downloads waiting.</p><p className="text-xs mt-1">Queued media will appear here when work is available.</p></div> : <div className="space-y-2">{active.map(j => <div key={j.id} className="bg-surface border border-border rounded-md p-3 hover:border-text-secondary/40 transition-colors">
        <div className="flex gap-3 items-center"><div className="w-24 h-14 rounded-sm overflow-hidden bg-surface-raised shrink-0">{j.thumbnail_url ? <img src={thumbnailSrc(j.thumbnail_url, j.resource_id)} className="w-full h-full object-cover" alt=""/> : <Film className="w-full h-full p-5 text-text-secondary"/>}</div><div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{j.resource_name}</div><div className="text-xs text-text-secondary mt-1 flex flex-wrap gap-3"><span className="capitalize">{j.status}</span><span>{j.quality}</span>{j.scheduled_for && <span><Clock3 size={12} className="inline mr-1"/>{new Date(j.scheduled_for).toLocaleString()}</span>}</div><div className="h-1.5 bg-bg rounded-full overflow-hidden mt-2" role="progressbar" aria-label={`Download progress for ${j.resource_name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(j.progress) || 0}><div className="h-full bg-accent" style={{ width: `${Number(j.progress) || 0}%` }}/></div></div><div className="flex gap-1 shrink-0">{j.status === 'downloading' ? <button aria-label="Pause download" title="Pause" onClick={() => change.mutate({ id: j.id, changes: { status: 'paused' } })} disabled={change.isPending} className={iconButtonClass}><Pause size={15}/></button> : j.status === 'paused' ? <button aria-label="Resume download" title="Resume" onClick={() => change.mutate({ id: j.id, changes: { status: 'queued' } })} disabled={change.isPending} className={iconButtonClass}><Play size={15}/></button> : form.mode === 'manual' && <button aria-label="Start download now" title="Start now" onClick={() => start.mutate(j.id)} disabled={start.isPending} className={iconButtonClass}><Play size={15}/></button>}<button aria-label="Schedule or edit download" title="Schedule / edit" onClick={() => beginEdit(j)} className={iconButtonClass}><CalendarClock size={15}/></button><button aria-label="Cancel download" title="Cancel" onClick={() => change.mutate({ id: j.id, changes: { status: 'cancelled' } })} disabled={change.isPending} className={iconButtonClass}><X size={15}/></button></div></div>
        {editing === j.id && <div className="mt-3 pt-3 border-t border-border grid grid-cols-1 md:grid-cols-4 gap-2"><label className="text-xs text-text-secondary">Quality<select value={draft.quality} onChange={e => setDraft({ ...draft, quality: e.target.value as DownloadQuality })} className={`mt-1 w-full ${controlClass}`}>{qualities.map(q => <option key={q}>{q}</option>)}</select></label><label className="text-xs text-text-secondary md:col-span-2">Schedule<input type="datetime-local" value={draft.scheduled_for} onChange={e => setDraft({ ...draft, scheduled_for: e.target.value })} className={`mt-1 w-full ${controlClass}`}/></label><label className="text-xs text-text-secondary">Priority<input type="number" min={-100} max={100} value={draft.priority} onChange={e => setDraft({ ...draft, priority: Number(e.target.value) || 0 })} className={`mt-1 w-full ${controlClass}`}/></label><div className="md:col-span-4 flex gap-2 justify-end"><button onClick={() => setEditing(null)} className="px-3 py-1.5 border border-border rounded-sm text-sm hover:bg-surface-raised focus:outline-none focus:ring-2 focus:ring-accent/40">Cancel</button><button onClick={() => saveJob(j)} disabled={change.isPending} className="px-3 py-1.5 bg-accent text-bg rounded-sm text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50">{change.isPending ? 'Saving…' : 'Save job'}</button></div></div>}
      </div>)}</div>}
    </section>

    <section>
      <SectionHeader icon={<HardDrive size={17}/>} title="History" detail="Completed, failed, and cancelled downloads" action={<span className="text-xs text-text-secondary">{completed.length} completed · {history.length} total</span>}/>
      {history.length === 0 ? <div className="border border-dashed border-border rounded-md p-8 text-center text-sm text-text-secondary"><HardDrive className="mx-auto mb-2 opacity-60" size={20}/><p>No download history yet.</p><p className="text-xs mt-1">Finished jobs will appear here for retry or cleanup.</p></div> : <div className="space-y-2">{history.map(j => <div key={j.id} className="bg-surface border border-border rounded-md p-3 flex items-center gap-3 hover:border-text-secondary/40 transition-colors"><div className="w-24 h-14 rounded-sm overflow-hidden bg-surface-raised shrink-0">{j.thumbnail_url ? <img src={thumbnailSrc(j.thumbnail_url, j.resource_id)} className="w-full h-full object-cover" alt=""/> : <Film className="w-full h-full p-5 text-text-secondary"/>}</div><div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{j.resource_name}</div><div className="text-xs text-text-secondary mt-1 capitalize">{j.status} · {formatBytes(j.local_media_size_bytes || j.total_bytes)}{j.error_message ? ` · ${j.error_message}` : ''}</div></div>{j.status === 'failed' && <button onClick={() => start.mutate(j.id)} disabled={start.isPending} className={iconButtonClass} title="Retry" aria-label="Retry download"><Play size={15}/></button>}<button onClick={() => remove.mutate(j.id)} disabled={remove.isPending} className={iconButtonClass} title="Remove" aria-label="Remove download"><Trash2 size={15}/></button></div>)}</div>}
    </section>
  </div>;
}
