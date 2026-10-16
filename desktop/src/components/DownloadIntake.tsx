import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarClock } from 'lucide-react';
import type { Resource } from '../api/resources';
import { queueVideoDownload, type DownloadQuality } from '../api/mediaDownloads';
import { captureAccountSession, isAccountSessionCurrent } from '../api/auth';
import { downloadFailureMessage } from '../api/download-presentation';
import { useToast } from '../contexts/ToastContext';
import DownloadResourcePreview from './DownloadResourcePreview';

/** A saved link is already in intake; only Downloads submits its schedule. */
export default function DownloadIntake({ resource, defaultQuality }: { resource: Resource; defaultQuality?: DownloadQuality }) {
  const account = captureAccountSession();
  const qc = useQueryClient();
  const { showToast } = useToast();
  const [quality, setQuality] = useState<DownloadQuality>(defaultQuality || '720p');
  const [schedule, setSchedule] = useState('');
  const submit = useMutation({
    mutationFn: async () => {
      if (!account || !isAccountSessionCurrent(account)) throw new Error('Account changed; reopen Downloads');
      const at = schedule ? new Date(schedule).toISOString() : undefined;
      return queueVideoDownload(resource.id, quality, at);
    },
    onSuccess: async job => {
      if (!account || !isAccountSessionCurrent(account)) return;
      const requested = schedule ? new Date(schedule).toISOString() : null;
      const returned = job.scheduled_for ? new Date(job.scheduled_for).toISOString() : null;
      showToast(job.quality !== quality || returned !== requested
        ? 'This link already has a download request. Review its schedule in the queue.'
        : job.sync_state === 'pending_sync' ? 'Download request saved on this PC — pending sync' : 'Download request accepted');
      await qc.invalidateQueries({ queryKey: ['media-downloads'] });
    },
  });
  const disabled = !account || submit.isPending || submit.isSuccess;
  const control = 'w-full mt-1 bg-surface-raised border border-border rounded-sm px-2.5 py-2 text-sm disabled:opacity-50';
  return <article className="bg-surface border border-border rounded-md p-3" aria-label={`Awaiting schedule: ${resource.name}`}>
    <div className="flex items-center gap-3">
      <DownloadResourcePreview resource={resource} job={{resource_id:resource.id,thumbnail_url:resource.thumbnail_url}}/>
      <div className="min-w-0 flex-1"><h4 className="text-sm font-medium truncate">{resource.name}</h4><p className="text-xs text-text-secondary mt-1">Awaiting schedule · saved link</p></div>
      <CalendarClock size={17} className="text-accent shrink-0"/>
    </div>
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-[8rem_1fr_auto] gap-3 items-end">
      <label className="text-xs text-text-secondary">Quality<select aria-label={`Quality for ${resource.name}`} value={quality} onChange={e=>setQuality(e.target.value as DownloadQuality)} disabled={disabled} className={control}>{['720p','1080p','480p','best'].map(q=><option key={q}>{q}</option>)}</select></label>
      <label className="text-xs text-text-secondary">Schedule (optional)<input aria-label={`Schedule for ${resource.name}`} type="datetime-local" value={schedule} onChange={e=>setSchedule(e.target.value)} disabled={disabled} className={control}/></label>
      <button type="button" onClick={()=>submit.mutate()} disabled={disabled} className="px-3 py-2 bg-accent text-bg rounded-sm text-sm disabled:opacity-50">{submit.isPending?'Saving…':submit.isSuccess?'Saved':schedule?'Save schedule':'Use download defaults'}</button>
    </div>
    <p className="text-xs text-text-secondary mt-2">Leave the time blank to use the download worker’s global schedule. Offline requests stay on this PC until synchronization.</p>
    {submit.isError&&<p role="alert" className="mt-2 text-xs text-status-danger">{downloadFailureMessage(submit.error,'Unable to save download schedule')}. The saved link remains here; you do not need to add it again.</p>}
  </article>;
}
