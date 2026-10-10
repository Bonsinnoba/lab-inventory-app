import { localBackend } from './local-backend';
import { listCatalog, mutateCatalog } from './catalog';
import { listMaintenance } from './maintenance';
import { getItems, updateItem } from './items';
import { apiFetch } from './http';
import {readLocalSections,type ReadAvailability} from './read-availability';

export interface Phase4Item { id: string; sync_version?:number; name: string; type: string; status: string; current_quantity: number; initial_quantity: number; unit?: string | null; storage_location?: string | null; storage_container_id?: string | null; storage_container_name?: string | null; storage_container_location?: string | null; location_name?: string | null; }
export interface StorageContainer { id: string; sync_version:number; name: string; container_type: string; storage_location?: string | null; capacity?: number | null; notes?: string | null; item_count: number; }
export interface PageMeta { page: number; page_size: number; total: number; total_pages: number; }
export interface Intelligence { availability?:ReadAvailability; inventory: { total_items: number|null; low_stock: number|null; depleted: number|null }; maintenance: { due: number|null }; storage: { total: number|null; labeled: number|null; contained: number|null }; signals: { level: string; message: string }[]; }
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
export const updateItemStorage = async (id: string, storage_location: string, storage_container_id: string | null, expectedVersion?:number):Promise<Phase4Item> => updateItem(id,{storage_location,storage_container_id},expectedVersion);
export const getPhase4Intelligence = async ():Promise<Intelligence> => {
  if(!localBackend.isAvailable())return json<Intelligence>('/phase4/intelligence');
  const {values,availability}=await readLocalSections({inventory:getItems,maintenance:()=>listMaintenance()});
  const items=values.inventory??[],records=values.maintenance??[];const due=Date.now()+14*86400000;
  const inventory={total_items:items.length,low_stock:items.filter(i=>i.status==='low_stock'||i.current_quantity<=i.initial_quantity*0.2).length,depleted:items.filter(i=>i.current_quantity<=0).length};
  const maintenance={due:records.filter(r=>['scheduled','in_progress'].includes(r.status)&&!!r.scheduled_date&&new Date(r.scheduled_date).getTime()<=due).length};
  const storage={total:items.length,labeled:items.filter(i=>i.storage_location?.trim()).length,contained:items.filter(i=>i.storage_container_id).length};
  return {availability,inventory:values.inventory===null?{total_items:null,low_stock:null,depleted:null}:inventory,maintenance:values.maintenance===null?{due:null}:maintenance,storage:values.inventory===null?{total:null,labeled:null,contained:null}:storage,signals:[...(inventory.depleted?[{level:'critical',message:`${inventory.depleted} item(s) are depleted`}]:[]),...(inventory.low_stock?[{level:'warning',message:`${inventory.low_stock} item(s) are at or below the 20% stock threshold`}]:[]),...(maintenance.due?[{level:'attention',message:`${maintenance.due} maintenance task(s) are due within 14 days`}]:[]),...(storage.total>storage.labeled?[{level:'attention',message:`${storage.total-storage.labeled} item(s) have no free-form storage label`}]:[])]};
};
