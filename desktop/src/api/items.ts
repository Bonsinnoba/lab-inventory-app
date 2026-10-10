import {writeInventoryHttp,inventoryVersion,inventoryBases,type InventoryBase} from './inventory-http';
import { apiFetch, getApiErrorMessage } from './http';
import { listMaintenance, mutateMaintenance } from './maintenance';
import { ensureItemSku } from './item-sku';
import { captureAccountSession, isAccountSessionCurrent } from './auth';
import { isLocalBackendAvailable as isTauriRuntime } from './local-backend';
import { bulkDeleteLocalInventoryItems, bulkUpdateLocalInventoryStatus, cacheLocalInventorySnapshot, cacheLocalItemMovements, createLocalInventoryItem, createLocalItemMovement, deleteLocalInventoryItem, getLocalInventoryOrRemote, getLocalInventorySnapshot, getLocalItemMovements, updateLocalInventoryItem } from './local-inventory';
function requireLocalInventoryWrite(): never { throw new Error('Local inventory is unavailable. Refresh or reconnect to LabOS before changing items.'); }
export interface Item { id:string; sync_version?:number; name:string; type:string; status:'available'|'in_use'|'damaged'|'needs_repair'|'needs_replacement'|'low_stock'|'retired'; location_id?:string; storage_location?:string|null; storage_container_id?:string|null; current_quantity:number; initial_quantity:number; unit?:string; sku?:string; category?:string; dimensions?:string; unit_cost?:number; replacement_cost?:number; condition_notes?:string; next_maintenance_date?:string|null; maintenance_interval_days?:number|null; image_resource_id?:string|null; manufacturer?:string|null; model_number?:string|null; serial_number?:string|null; asset_tag?:string|null; calibration_interval_days?:number|null; next_calibration_date?:string|null; assigned_to?:string|null; assigned_to_username?:string|null; supplier?:string|null; supplier_id?:string|null; part_number?:string|null; acquisition_method?:'unspecified'|'purchased'|'salvaged'|'donated'|'transferred'|'fabricated'|'other'; acquisition_source?:string|null; acquisition_notes?:string|null; created_at:string; updated_at:string; }
async function getItemsRemote(filters?:{type?:string;status?:string;location?:string;location_id?:string;low_stock?:boolean}):Promise<Item[]>{const p=new URLSearchParams();if(filters?.type)p.append('type',filters.type);if(filters?.status)p.append('status',filters.status);if(filters?.location)p.append('location',filters.location);if(filters?.location_id)p.append('location_id',filters.location_id);if(filters?.low_stock)p.append('low_stock','true');const r=await apiFetch(`/items?${p}`);if(!r.ok)throw new Error('Failed to fetch items');return r.json();}
export async function getItems(filters?:{type?:string;status?:string;location?:string;location_id?:string;low_stock?:boolean}):Promise<Item[]>{return getLocalInventoryOrRemote(()=>getItemsRemote(),filters);}
export async function getItem(id:string):Promise<Item>{const local=await getLocalInventorySnapshot();const cached=local?.find(i=>i.id===id);if(cached)return cached;const r=await apiFetch(`/items/${id}`);if(!r.ok)throw new Error('Failed to fetch item');return r.json();}
export interface ItemHistoryEntry{id:string;item_id:string;field_name:string;old_value:string|null;new_value:string|null;changed_at:string;}
export async function getItemHistory(id:string):Promise<ItemHistoryEntry[]>{const r=await apiFetch(`/items/${id}/history`);if(!r.ok)throw new Error('Failed to fetch item history');return r.json();}
export interface ItemAssignmentHistoryEntry{id:string;action:string;old_assignee_username?:string|null;new_assignee_username?:string|null;actor_username?:string|null;created_at:string;}
export async function getItemAssignmentHistory(id:string):Promise<ItemAssignmentHistoryEntry[]>{const r=await apiFetch(`/items/${id}/assignment-history`);if(!r.ok)throw new Error('Failed to fetch item assignment history');return r.json();}
export async function getItemBySku(sku:string):Promise<Item>{const local=await getLocalInventorySnapshot();if(local){const normalized=sku.trim().toLowerCase();const cached=local.find(i=>String(i.sku||'').trim().toLowerCase()===normalized);if(cached)return cached;throw new Error('Item not found');}const r=await apiFetch(`/items/by-sku/${encodeURIComponent(sku)}`);if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||'Item not found');return r.json();}
export async function createItem(item:Omit<Item,'id'|'created_at'|'updated_at'>):Promise<Item>{const normalized={...item,sku:ensureItemSku(item.sku,item.name,item.type)};const local=await createLocalInventoryItem(normalized);if(local)return local;if(isTauriRuntime())requireLocalInventoryWrite();return writeInventoryHttp<Item>('/items','POST',{...item},true);}
export async function updateItem(id:string,item:Partial<Item>,expectedVersion?:number):Promise<Item>{const local=await updateLocalInventoryItem(id,item);if(local)return local;if(isTauriRuntime())requireLocalInventoryWrite();return writeInventoryHttp<Item>(`/items/${id}`,'PUT',{...item,expected_version:inventoryVersion(expectedVersion)});}
export async function deleteItem(id:string,expectedVersion?:number):Promise<void>{if(await deleteLocalInventoryItem(id))return;if(isTauriRuntime())requireLocalInventoryWrite();return writeInventoryHttp<void>(`/items/${id}`,'DELETE',{expected_version:inventoryVersion(expectedVersion)});}
export async function bulkUpdateItemStatus(ids:string[],status:Item['status'],versions?:InventoryBase[]):Promise<{updated:number}>{const local=await bulkUpdateLocalInventoryStatus(ids,status);if(local!==null)return{updated:local};if(isTauriRuntime())requireLocalInventoryWrite();return writeInventoryHttp('/items/bulk-status','POST',{ids:[...ids].sort(),status,item_bases:inventoryBases(ids,versions)});}
export async function bulkDeleteItems(ids:string[],versions?:InventoryBase[]):Promise<{deleted:number}>{const local=await bulkDeleteLocalInventoryItems(ids);if(local!==null)return{deleted:local};if(isTauriRuntime())requireLocalInventoryWrite();return writeInventoryHttp('/items/bulk-delete','POST',{ids:[...ids].sort(),item_bases:inventoryBases(ids,versions)});}
export type MovementType='receive'|'checkout'|'return'|'consume'|'adjust'|'transfer'|'damage'|'loss'|'repair_out'|'repair_in';
export interface ItemMovement{id:string;item_id:string;movement_type:MovementType;quantity:number;quantity_before:number;quantity_after:number;from_location_id?:string|null;to_location_id?:string|null;from_location_name?:string|null;to_location_name?:string|null;from_storage_location?:string|null;to_storage_location?:string|null;project_id?:string|null;project_name?:string|null;reason?:string|null;reference?:string|null;performed_by?:string|null;performed_by_username?:string|null;created_at:string;}
export interface MaintenanceRecord{id:string;item_id:string;maintenance_type:'routine'|'repair'|'inspection'|'calibration'|'cleaning'|'other';status:'scheduled'|'in_progress'|'completed'|'cancelled';scheduled_date?:string|null;completed_date?:string|null;performed_by?:string|null;performed_by_username?:string|null;notes?:string|null;cost?:number|null;created_at:string;updated_at:string;sync_version:number;}
export async function getItemMovements(id:string):Promise<ItemMovement[]>{
  const session=captureAccountSession();if(!session)throw new Error('Sign in to read inventory history');
  const local=await getLocalItemMovements(id);
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading inventory history');
  if(session.token.startsWith('local:')||(typeof navigator!=='undefined'&&!navigator.onLine)){
    if(local!==null)return local;throw new Error('Inventory history has not been downloaded for offline use');
  }
  let response:Response;
  try{response=await apiFetch(`/items/${id}/movements`);}
  catch(error){if(local!==null&&isAccountSessionCurrent(session))return local;throw error;}
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while refreshing inventory history');
  if(!response.ok){
    if(response.status>=500&&local!==null)return local;
    throw new Error(await getApiErrorMessage(response,'Unable to refresh inventory history'));
  }
  const remote:ItemMovement[]=await response.json();
  if(!Array.isArray(remote))throw new Error('Invalid inventory history response');
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while refreshing inventory history');
  await cacheLocalItemMovements(id,remote,session);
  // Native merge preserves pending movement records and their optimistic values.
  const merged=await getLocalItemMovements(id);
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading refreshed history');
  return merged??remote;
}
export async function createItemMovement(id:string,movement:{movement_type:MovementType;quantity:number;to_storage_location?:string;to_location_id?:string;project_id?:string;reason?:string;reference?:string;},expectedVersion?:number):Promise<{item:Item;movement:ItemMovement}>{const local=await createLocalItemMovement(id,movement);if(local)return local;if(isTauriRuntime())requireLocalInventoryWrite();return writeInventoryHttp(`/items/${id}/movements`,'POST',{...movement,expected_version:inventoryVersion(expectedVersion)},true);}
// Desktop maintenance is atomic SQLite/outbox; browser mutations use versioned HTTP.
export const getMaintenanceRecords=(id:string):Promise<MaintenanceRecord[]>=>listMaintenance(id);
export const createMaintenanceRecord=(id:string,record:Partial<MaintenanceRecord>):Promise<MaintenanceRecord>=>mutateMaintenance(id,'create',record);
export const updateMaintenanceRecord=(itemId:string,id:string,record:Partial<MaintenanceRecord>,version:number):Promise<MaintenanceRecord>=>mutateMaintenance(itemId,'update',record,id,version);
export async function deleteMaintenanceRecord(itemId:string,id:string,version:number):Promise<void>{await mutateMaintenance(itemId,'delete',{},id,version);}
