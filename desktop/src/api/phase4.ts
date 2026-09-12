import { apiFetch } from './http';

export interface Phase4Item { id: string; name: string; type: string; status: string; current_quantity: number; initial_quantity: number; unit?: string | null; storage_location?: string | null; storage_container_id?: string | null; storage_container_name?: string | null; storage_container_location?: string | null; location_name?: string | null; }
export interface StorageContainer { id: string; name: string; container_type: string; storage_location?: string | null; capacity?: number | null; notes?: string | null; item_count: number; }
export interface PageMeta { page: number; page_size: number; total: number; total_pages: number; }
export interface Intelligence { inventory: { total_items: number; low_stock: number; depleted: number }; maintenance: { due: number }; storage: { total: number; labeled: number; contained: number }; signals: { level: string; message: string }[]; }
async function json<T>(path: string, options?: RequestInit): Promise<T> { const response = await apiFetch(path, options); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body?.error?.message || body?.error || 'Phase 4 request failed'); return body; }
export const getPhase4Items = (page = 1, pageSize = 6, search = '') => json<{items: Phase4Item[]}&PageMeta>(`/phase4/items?page=${page}&page_size=${pageSize}&search=${encodeURIComponent(search)}`);
export const getStorageContainers = (page = 1, pageSize = 6) => json<{containers: StorageContainer[]}&PageMeta>(`/phase4/containers?page=${page}&page_size=${pageSize}`);
export const createStorageContainer = (container: Partial<StorageContainer>) => json<StorageContainer>('/phase4/containers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(container) });
export const updateStorageContainer = (id: string, container: Partial<StorageContainer>) => json<StorageContainer>(`/phase4/containers/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(container) });
export const deleteStorageContainer = (id: string) => json<{success: boolean}>(`/phase4/containers/${id}`, { method: 'DELETE' });
export const updateItemStorage = (id: string, storage_location: string, storage_container_id: string | null) => json<Phase4Item>(`/phase4/items/${id}/storage`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storage_location, storage_container_id }) });
export const getPhase4Intelligence = () => json<Intelligence>('/phase4/intelligence');
