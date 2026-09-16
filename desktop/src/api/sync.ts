import { invoke } from '@tauri-apps/api/tauri';
import { apiFetch, getApiErrorMessage } from './http';

type PendingChange = {
  change_id: string;
  device_id: string;
  entity_type: string;
  entity_id?: string | null;
  operation: string;
  payload: unknown;
  created_at: string;
  attempt_count: number;
  last_error?: string | null;
};

type SyncResult = { change_id: string; status: 'synced' | 'failed' | 'rejected'; result?: unknown; error?: { code?: string; message?: string } };

let activeSync: Promise<number> | null = null;

export async function getPendingSyncCount(): Promise<number> {
  try {
    const status = await invoke<{ pending_sync_count: number }>('local_database_status');
    return Number(status.pending_sync_count || 0);
  } catch {
    return 0;
  }
}

export async function syncPendingChanges(): Promise<number> {
  if (activeSync) return activeSync;
  activeSync = runSync().finally(() => { activeSync = null; });
  return activeSync;
}

async function runSync(): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
  let changes: PendingChange[];
  try {
    changes = await invoke<PendingChange[]>('list_pending_sync_changes', { limit: 100 });
  } catch {
    return 0;
  }
  if (!changes.length) return 0;

  const deviceId = changes[0].device_id;
  try {
    const response = await apiFetch('/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId, changes: changes.map(({ change_id, entity_type, entity_id, operation, payload }) => ({ change_id, entity_type, entity_id, operation, payload })) }),
    });
    if (!response.ok) {
      const message = await getApiErrorMessage(response, 'Unable to synchronize local changes');
      for (const change of changes) await invoke('record_sync_failure', { changeId: change.change_id, error: message }).catch(() => undefined);
      return 0;
    }
    const body = await response.json() as { results?: SyncResult[] };
    const results = Array.isArray(body.results) ? body.results : [];
    const synced = results.filter((result) => result.status === 'synced').map((result) => result.change_id).filter(Boolean);
    if (synced.length) await invoke('mark_sync_changes_synced', { changeIds: synced });
    for (const result of results.filter((entry) => entry.status !== 'synced')) {
      await invoke('record_sync_failure', { changeId: result.change_id, error: result.error?.message || result.error?.code || 'Server rejected sync change' }).catch(() => undefined);
    }
    return synced.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const change of changes) await invoke('record_sync_failure', { changeId: change.change_id, error: message }).catch(() => undefined);
    return 0;
  }
}
