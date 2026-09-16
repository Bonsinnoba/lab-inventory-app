import { invoke } from '@tauri-apps/api/tauri';
import type { Item } from './items';

export async function getLocalInventorySnapshot(): Promise<Item[] | null> {
  try {
    const raw = await invoke<string | null>('get_local_inventory_snapshot');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as Item[] : null;
  } catch {
    return null;
  }
}

export async function cacheLocalInventorySnapshot(items: Item[]): Promise<void> {
  try {
    await invoke('cache_local_inventory_snapshot', { snapshotJson: JSON.stringify(items) });
  } catch {
    // Web development mode has no Tauri IPC; the remote API remains the source there.
  }
}

async function saveSnapshotWithSync(
  snapshot: Item[],
  change: { entity_type: string; entity_id?: string; operation: string; payload: unknown },
): Promise<void> {
  await invoke('save_local_snapshot_with_sync', {
    input: {
      snapshotJson: JSON.stringify(snapshot),
      changeId: crypto.randomUUID().replaceAll('-', ''),
      entityType: change.entity_type,
      entityId: change.entity_id ?? null,
      operation: change.operation,
      payloadJson: JSON.stringify(change.payload),
    },
  });
}

export async function createLocalInventoryItem(item: Omit<Item, 'id' | 'created_at' | 'updated_at'>): Promise<Item | null> {
  const local = await getLocalInventorySnapshot();
  if (!local) return null;
  const now = new Date().toISOString();
  const created: Item = { ...item, id: crypto.randomUUID(), created_at: now, updated_at: now };
  await saveSnapshotWithSync([...local, created], {
    entity_type: 'item', entity_id: created.id, operation: 'create', payload: created,
  });
  return created;
}

export async function updateLocalInventoryItem(id: string, patch: Partial<Item>): Promise<Item | null> {
  const local = await getLocalInventorySnapshot();
  if (!local) return null;
  const index = local.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('Item not found in local inventory');
  const updated: Item = { ...local[index], ...patch, id, updated_at: new Date().toISOString() };
  const next = [...local];
  next[index] = updated;
  await saveSnapshotWithSync(next, {
    entity_type: 'item', entity_id: id, operation: 'update', payload: { id, patch, item: updated },
  });
  return updated;
}

export async function deleteLocalInventoryItem(id: string): Promise<boolean> {
  const local = await getLocalInventorySnapshot();
  if (!local) return false;
  if (!local.some((item) => item.id === id)) throw new Error('Item not found in local inventory');
  await saveSnapshotWithSync(local.filter((item) => item.id !== id), {
    entity_type: 'item', entity_id: id, operation: 'delete', payload: { id },
  });
  return true;
}

export async function bulkUpdateLocalInventoryStatus(ids: string[], status: Item['status']): Promise<number | null> {
  const local = await getLocalInventorySnapshot();
  if (!local) return null;
  const idSet = new Set(ids);
  let updatedCount = 0;
  const next = local.map((item) => {
    if (!idSet.has(item.id)) return item;
    updatedCount += 1;
    return { ...item, status, updated_at: new Date().toISOString() };
  });
  if (updatedCount === 0) return 0;
  await saveSnapshotWithSync(next, {
    entity_type: 'item', operation: 'bulk_status', payload: { ids, status },
  });
  return updatedCount;
}

export async function bulkDeleteLocalInventoryItems(ids: string[]): Promise<number | null> {
  const local = await getLocalInventorySnapshot();
  if (!local) return null;
  const idSet = new Set(ids);
  const deleted = local.filter((item) => idSet.has(item.id)).map((item) => item.id);
  if (deleted.length === 0) return 0;
  await saveSnapshotWithSync(local.filter((item) => !idSet.has(item.id)), {
    entity_type: 'item', operation: 'bulk_delete', payload: { ids: deleted },
  });
  return deleted.length;
}

export async function getLocalInventoryOrRemote(
  remoteLoader: () => Promise<Item[]>,
  filters?: { type?: string; status?: string; location?: string; location_id?: string; low_stock?: boolean },
): Promise<Item[]> {
  const local = await getLocalInventorySnapshot();
  if (local !== null) return applyInventoryFilters(local, filters);

  const remote = await remoteLoader();
  await cacheLocalInventorySnapshot(remote);
  return applyInventoryFilters(remote, filters);
}

function applyInventoryFilters(items: Item[], filters?: { type?: string; status?: string; location?: string; location_id?: string; low_stock?: boolean }): Item[] {
  if (!filters) return items;
  const query = filters.location?.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.type && item.type !== filters.type) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.location_id && item.location_id !== filters.location_id) return false;
    if (filters.low_stock && item.status !== 'low_stock' && !(item.current_quantity <= 0)) return false;
    if (query) {
      const location = `${item.storage_location || ''}`.toLowerCase();
      if (!location.includes(query)) return false;
    }
    return true;
  });
}
