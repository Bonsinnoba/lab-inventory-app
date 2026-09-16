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

export async function getLocalInventoryOrRemote(
  remoteLoader: () => Promise<Item[]>,
  filters?: { type?: string; status?: string; location?: string; location_id?: string; low_stock?: boolean },
): Promise<Item[]> {
  const local = await getLocalInventorySnapshot();
  if (local && local.length > 0) return applyInventoryFilters(local, filters);

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
