import { Link } from 'react-router-dom';
import { Download, FolderOpen, Music2, Settings2 } from 'lucide-react';
import DailyUsePanel from './DailyUsePanel';

interface Props { open: boolean; onOpenMusic: () => void; canManageDownloads?: boolean; }

export default function MediaManager({ open, onOpenMusic, canManageDownloads = false }: Props) {
  if (!open) return null;
  return <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div><div className="page-kicker">LabOS / Daily workspace</div><h1 className="mt-1 text-page-title font-semibold">Media & System</h1><p className="mt-2 max-w-2xl text-sm text-text-secondary">Music, lab media, daily preferences and system tools in one workspace.</p></div>
      <Link to="/settings" className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm hover:border-accent"><Settings2 size={16}/>Account & appearance</Link>
    </header>
    <nav aria-label="Media and system sections" className="flex flex-wrap gap-2 text-xs">
      { [['daily-media','Media'],['daily-preferences','Preferences'],['daily-system','System health'],['daily-backup','Backup & export']].map(([id,label])=><button key={id} type="button" className="rounded-full border border-border bg-surface px-3 py-2 text-text-secondary hover:border-accent hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" onClick={()=>document.getElementById(id)?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}>{label}</button>)}
    </nav>
    <section id="daily-media" aria-labelledby="daily-media-heading" className="scroll-mt-5 space-y-3">
      <h2 id="daily-media-heading" className="text-sm font-semibold">Your media workspace</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button type="button" onClick={onOpenMusic} className="media-hub-card text-left"><Music2 size={24} className="text-accent"/><span className="block text-sm font-semibold">Music player</span><span className="block text-xs leading-relaxed text-text-secondary">Open your local library and playback controls. Music stays on this device.</span></button>
        <Link to="/resources" className="media-hub-card"><FolderOpen size={24} className="text-accent"/><span className="block text-sm font-semibold">Lab resources</span><span className="block text-xs leading-relaxed text-text-secondary">Browse files, folders and links. Open documents or compare resources in the viewer.</span></Link>
        {canManageDownloads&&<Link to="/downloads" className="media-hub-card"><Download size={24} className="text-accent"/><span className="block text-sm font-semibold">Download schedules</span><span className="block text-xs leading-relaxed text-text-secondary">Schedule saved links and inspect server downloads and PC copies.</span></Link>}
      </div>
    </section>
    <DailyUsePanel embedded/>
  </div>;
}
