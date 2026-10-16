import type { DownloadJob } from './mediaDownloads';

export function downloadFailureMessage(error: unknown, fallback: string): string {
  // Tauri rejects with strings, not necessarily Error instances.
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : '';
  return message.trim().slice(0, 400) || fallback;
}

export function resourceQueueJob(jobs: DownloadJob[], resourceId: string): DownloadJob | undefined {
  return jobs.find(job => job.resource_id === resourceId && (
    job.sync_state === 'pending_sync' || job.sync_state === 'conflict' ||
    ['queued', 'scheduled', 'downloading', 'paused'].includes(job.status)
  ));
}

export function resourceQueueLabel(job: DownloadJob): string {
  if (job.sync_state === 'conflict') return 'Download sync conflict';
  if (job.sync_state === 'pending_sync') return job.pending_action
    ? `${job.pending_action} pending sync` : 'Queued on this PC · pending sync';
  return `${job.status.charAt(0).toUpperCase()}${job.status.slice(1)} on server`;
}
