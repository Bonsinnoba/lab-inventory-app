import type { Resource } from './resources';
import { getAllResources, getResources } from './resources';
import { getDownloadJobs, type DownloadJob } from './mediaDownloads';
import { readDownloadSnapshot } from './downloads-local';
import { captureAccountSession, isAccountSessionCurrent } from './auth';
import { isTauriRuntime } from '../lib/runtime';

const identity = (id: string) => id.replaceAll('-', '').toLowerCase();
export function isDownloadableLink(resource: Resource): boolean {
  if (resource.kind !== 'link' || !resource.url || resource.local_media_filename || resource.local_media_path || resource.local_media_downloaded_at) return false;
  try {
    const url = new URL(resource.url);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    return ['youtube.com', 'youtu.be', 'facebook.com', 'fb.watch', 'instagram.com'].some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}

// Any existing job owns its resource's queue/history presentation, including
// cancellation/failure/conflict. Never turn a cancelled job back into new work.
export function waitingDownloadLinks(resources: Resource[], jobs: DownloadJob[]): Resource[] {
  const represented = new Set(jobs.map(job => identity(job.resource_id)));
  return resources.filter(resource => {
    const id = identity(resource.id);
    if (!isDownloadableLink(resource) || represented.has(id)) return false;
    represented.add(id);
    return true;
  });
}

export async function readDownloadIntake() {
  const session = captureAccountSession();
  if (!session) throw new Error('Sign in to read download intake');
  const check = () => { if (!isAccountSessionCurrent(session)) throw new Error('Account changed while reading download intake'); };
  if (isTauriRuntime()) {
    // One SQLite read transaction includes resources, server jobs and pending
    // intents. No HTTP fallback, job creation, or new persisted queue is needed.
    const snapshot = await readDownloadSnapshot(); check();
    if (!Array.isArray(snapshot.resource_links)) throw new Error('Restart with the updated desktop build to show links awaiting scheduling');
    return { session, resources: waitingDownloadLinks(snapshot.resource_links, snapshot.jobs), complete: snapshot.snapshot_complete };
  }
  const jobs = await getDownloadJobs(); check();
  const rows = await getAllResources(); check();
  // Browser folder reads use the existing authorized resource API. Desktop
  // already has every visible link in its local snapshot, with no folder walks.
  const seen = new Set<string>();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.kind !== 'folder' || seen.has(identity(row.id))) continue;
    seen.add(identity(row.id));
    rows.push(...await getResources({ parent_resource_id: row.id })); check();
  }
  return { session, resources: waitingDownloadLinks(rows, jobs), complete: true };
}
