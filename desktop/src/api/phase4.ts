import { localBackend } from './local-backend';
import { listCatalog, mutateCatalog } from './catalog';
import { getItems, updateItem } from './items';
import { apiFetch } from './http';

export interface Phase4Item { id: string; name: string; type: string; status: string; current_quantity: number; initial_quantity: number; unit?: string | null; storage_location?: string | null; storage_container_id?: string | null; storage_container_name?: string | null; storage_container_location?: string | null; location_name?: string | null; }
export interface StorageContainer { id: string; sync_version:number; name: string; container_type: string; storage_location?: string | null; capacity?: number | null; notes?: string | null; item_count: number; }
export interface PageMeta { page: number; page_size: number; total: number; total_pages: number; }
export interface Intelligence { inventory: { total_items: number; low_stock: number; depleted: number }; maintenance: { due: number }; storage: { total: number; labeled: number; contained: number }; signals: { level: string; message: string }[]; }
async function json<T>(path: string, options?: RequestInit): Promise<T> { const response = await apiFetch(path, options); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body?.error?.message || body?.error || 'Phase 4 request failed'); return body; }
export const getPhase4Items = async (page=1,pageSize=6,search='') => {
  if(!localBackend.isAvailable())return json<{items:Phase4Item[]}&PageMeta>(`/phase4/items?page=${page}&page_size=${pageSize}&search=${encodeURIComponent(search)}`);
  const [items,containers]=await Promise.all([getItems(),listCatalog<StorageContainer>('storage_container')]);
  const rows=items.map(item=>{const c=containers.find(c=>c.id===item.storage_container_id);return {...item,storage_container_name:c?.name,storage_container_location:c?.storage_location};}).filter(i=>[i.name,i.sku,i.storage_location,i.storage_container_name,i.storage_container_location].some(v=>v?.toLowerCase().includes(search.toLowerCase()))).sort((a,b)=>a.name.localeCompare(b.name));
  return {items:rows.slice((page-1)*pageSize,page*pageSize),page,page_size:pageSize,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/pageSize))};
};
export const getStorageContainers = async (page=1,pageSize=6) => {const rows=await listCatalog<StorageContainer>('storage_container');page=Math.max(1,Math.floor(page));pageSize=Math.max(1,Math.min(100,Math.floor(pageSize)));return {containers:rows.sort((a,b)=>a.name.localeCompare(b.name)).slice((page-1)*pageSize,page*pageSize),page,page_size:pageSize,total:rows.length,total_pages:Math.max(1,Math.ceil(rows.length/pageSize))};};
export const createStorageContainer=(container:Partial<StorageContainer>)=>mutateCatalog<StorageContainer>('storage_container','create',container);
export const updateStorageContainer=(id:string,container:Partial<StorageContainer>,expectedVersion:number)=>mutateCatalog<StorageContainer>('storage_container','update',container,id,expectedVersion);
export const deleteStorageContainer=(record:Pick<StorageContainer,'id'|'sync_version'>)=>mutateCatalog<{success:boolean}>('storage_container','delete',{},record.id,record.sync_version);
export const updateItemStorage = async (id: string, storage_location: string, storage_container_id: string | null):Promise<Phase4Item> => localBackend.isAvailable()?updateItem(id,{storage_location,storage_container_id}):json<Phase4Item>(`/phase4/items/${id}/storage`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storage_location, storage_container_id }) });
export const getPhase4Intelligence = () => json<Intelligence>('/phase4/intelligence');
