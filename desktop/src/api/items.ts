import {writeInventoryHttp,inventoryVersion,inventoryBases,type InventoryBase} from './inventory-http';
import { apiFetch, getApiErrorMessage } from './http';
import { listMaintenance, mutateMaintenance } from './maintenance';
import { ensureItemSku } from './item-sku';
import { captureAccountSession, isAccountSessionCurrent, type AccountSession } from './auth';
import { isLocalBackendAvailable as isTauriRuntime } from './local-backend';
import { createLocalCustodyMovement, hasCustodyIntent } from './local-inventory';
import { bulkDeleteLocalInventoryItems, bulkUpdateLocalInventoryStatus, cacheLocalAssigneeDirectory, cacheLocalInventorySnapshot, cacheLocalItemAssignmentHistory, cacheLocalItemCustody, cacheLocalItemFieldHistory, cacheLocalItemMovements, createLocalInventoryItem, createLocalItemMovement, deleteLocalInventoryItem, getLocalAssigneeDirectory, getLocalInventoryOrRemote, getLocalInventorySnapshot, getLocalItemAssignmentHistory, getLocalItemCustody, getLocalItemFieldHistory, getLocalItemMovements, updateLocalInventoryItem } from './local-inventory';
function requireLocalInventoryWrite(): never { throw new Error('Local inventory is unavailable. Refresh or reconnect to LabOS before changing items.'); }
export interface Item { id:string; sync_version?:number; name:string; type:string; status:'available'|'in_use'|'damaged'|'needs_repair'|'needs_replacement'|'low_stock'|'retired'; location_id?:string; storage_location?:string|null; storage_container_id?:string|null; current_quantity:number; initial_quantity:number; unit?:string; sku?:string; category?:string; dimensions?:string; unit_cost?:number; replacement_cost?:number; condition_notes?:string; next_maintenance_date?:string|null; maintenance_interval_days?:number|null; image_resource_id?:string|null; manufacturer?:string|null; model_number?:string|null; serial_number?:string|null; asset_tag?:string|null; calibration_interval_days?:number|null; next_calibration_date?:string|null; assigned_to?:string|null; assigned_to_username?:string|null; supplier?:string|null; supplier_id?:string|null; part_number?:string|null; acquisition_method?:'unspecified'|'purchased'|'salvaged'|'donated'|'transferred'|'fabricated'|'other'; acquisition_source?:string|null; acquisition_notes?:string|null; created_at:string; updated_at:string; }
async function getItemsRemote(filters?:{type?:string;status?:string;location?:string;location_id?:string;low_stock?:boolean}):Promise<Item[]>{const p=new URLSearchParams();if(filters?.type)p.append('type',filters.type);if(filters?.status)p.append('status',filters.status);if(filters?.location)p.append('location',filters.location);if(filters?.location_id)p.append('location_id',filters.location_id);if(filters?.low_stock)p.append('low_stock','true');const r=await apiFetch(`/items?${p}`);if(!r.ok)throw new Error('Failed to fetch items');return r.json();}
export async function getItems(filters?:{type?:string;status?:string;location?:string;location_id?:string;low_stock?:boolean}):Promise<Item[]>{return getLocalInventoryOrRemote(()=>getItemsRemote(),filters);}
export async function getItem(id:string):Promise<Item>{const local=await getLocalInventorySnapshot();const cached=local?.find(i=>i.id===id);if(cached)return cached;const r=await apiFetch(`/items/${id}`);if(!r.ok)throw new Error('Failed to fetch item');return r.json();}
export interface ItemHistoryEntry{id:string;item_id:string;field_name:string;old_value:string|null;new_value:string|null;changed_at:string;}
// Keep cache persistence/decoding outside the transport catch: an authorization,
// disk or malformed-response error is not permission to return an older snapshot.
async function readAccountInventoryRows<T>(
  path: string,
  readLocal: () => Promise<T[] | null>,
  cache: (rows: T[], session: AccountSession) => Promise<void>,
): Promise<T[]> {
  const session = captureAccountSession();
  if (!session) throw new Error('Sign in to read inventory history');
  const assertCurrent = () => {
    if (!isAccountSessionCurrent(session)) throw new Error('Account changed while reading inventory history');
  };
  const checkedLocal = async () => {
    assertCurrent();
    const rows = await readLocal(); // Native reader checks the current lease/permission.
    assertCurrent();
    return rows;
  };
  const local = await checkedLocal();
  if (session.token.startsWith('local:') || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    if (local !== null) return local;
    throw new Error('Inventory history has not been downloaded for offline use');
  }
  let response: Response;
  try {
    response = await apiFetch(path);
  } catch (error) {
    // Re-read instead of returning the captured rows: permissions or lease may
    // have changed during the network wait even if the account is unchanged.
    const fallback = await checkedLocal();
    if (fallback !== null) return fallback;
    throw error;
  }
  assertCurrent();
  if (!response.ok) {
    if (response.status >= 500) {
      const fallback = await checkedLocal();
      if (fallback !== null) return fallback;
    }
    throw new Error(await getApiErrorMessage(response, 'Unable to refresh inventory history'));
  }
  const remote: T[] = await response.json();
  assertCurrent();
  if (!Array.isArray(remote)) throw new Error('Invalid inventory history response');
  await cache(remote, session);
  assertCurrent();
  const merged = await checkedLocal();
  return merged ?? remote;
}
export async function getItemHistory(id:string):Promise<ItemHistoryEntry[]>{
  return readAccountInventoryRows(`/items/${id}/history`, () => getLocalItemFieldHistory(id),
    (rows, session) => cacheLocalItemFieldHistory(id, rows, session));
}
export interface ItemAssignmentHistoryEntry{id:string;action:string;old_assignee_username?:string|null;new_assignee_username?:string|null;actor_username?:string|null;created_at:string;}
export async function getItemAssignmentHistory(id:string):Promise<ItemAssignmentHistoryEntry[]>{
  return readAccountInventoryRows(`/items/${id}/assignment-history`, () => getLocalItemAssignmentHistory(id),
    (rows, session) => cacheLocalItemAssignmentHistory(id, rows, session));
}
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
  // Native merge preserves pending movement records and their optimistic values.
  return readAccountInventoryRows(`/items/${id}/movements`, () => getLocalItemMovements(id),
    (rows, session) => cacheLocalItemMovements(id, rows, session));
}
export interface MovementOptions {
  movement_id?: string;
  movement_type: MovementType;
  quantity: number;
  to_storage_location?: string;
  to_location_id?: string;
  project_id?: string;
  reason?: string;
  reference?: string;
  recipient_id?: string;
  custody_id?: string;
  settlement_type?: 'return' | 'consume' | 'damage' | 'loss' | 'transfer';
  transfer_recipient_id?: string;
  task_id?: string;
  experiment_id?: string;
  requirement_id?: string;
  reservation_id?: string;
  serial_number?: string;
  notes?: string;
}

export async function createItemMovement(id:string,movement:MovementOptions,expectedVersion?:number):Promise<{item:Item;movement:ItemMovement}>{const local=await (hasCustodyIntent(movement)?createLocalCustodyMovement(id,movement):createLocalItemMovement(id,movement));if(local)return local;if(isTauriRuntime())requireLocalInventoryWrite();return writeInventoryHttp(`/items/${id}/movements`,'POST',{...movement,expected_version:inventoryVersion(expectedVersion)},true);}
// Desktop maintenance is atomic SQLite/outbox; browser mutations use versioned HTTP.
export const getMaintenanceRecords=(id:string):Promise<MaintenanceRecord[]>=>listMaintenance(id);
export const createMaintenanceRecord=(id:string,record:Partial<MaintenanceRecord>):Promise<MaintenanceRecord>=>mutateMaintenance(id,'create',record);
export const updateMaintenanceRecord=(itemId:string,id:string,record:Partial<MaintenanceRecord>,version:number):Promise<MaintenanceRecord>=>mutateMaintenance(itemId,'update',record,id,version);
export async function deleteMaintenanceRecord(itemId:string,id:string,version:number):Promise<void>{await mutateMaintenance(itemId,'delete',{},id,version);}

export interface ItemCustodyRecord {
  id: string;
  item_id: string;
  source_movement_id?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  task_id?: string | null;
  experiment_id?: string | null;
  requirement_id?: string | null;
  reservation_id?: string | null;
  recipient_id: string;
  recipient_username?: string | null;
  recipient_display_name?: string | null;
  issued_by: string;
  issued_by_username?: string | null;
  initial_quantity: number;
  outstanding_quantity: number;
  unit?: string | null;
  serial_number?: string | null;
  status: 'issued' | 'partially_settled' | 'settled';
  notes?: string | null;
  issued_at: string;
  settled_at?: string | null;
  settlements?: ItemCustodySettlement[];
}

export interface ItemCustodySettlement {
  id: string;
  custody_id: string;
  settlement_type: 'return' | 'consume' | 'damage' | 'loss' | 'transfer';
  quantity: number;
  performed_by: string;
  performed_by_username?: string | null;
  transfer_recipient_id?: string | null;
  transfer_recipient_username?: string | null;
  movement_id?: string | null;
  notes?: string | null;
  settled_at: string;
}

export async function getItemCustody(id: string): Promise<ItemCustodyRecord[]> {
  return readAccountInventoryRows(`/items/${id}/custody`, () => getLocalItemCustody(id),
    (rows, session) => cacheLocalItemCustody(id, rows, session));
}

export interface AssigneeUser {
  id: string;
  username: string;
  display_name?: string | null;
  email?: string | null;
  role: string;
}

export async function getAssigneeDirectory(): Promise<AssigneeUser[]> {
  return readAccountInventoryRows('/items/assignees/directory', getLocalAssigneeDirectory,
    cacheLocalAssigneeDirectory);
}

export interface SalvageRecovery {
  id: string;
  source_item_id?: string | null;
  source_item_name?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  recovery_type: 'unused_stock_return' | 'equipment_return' | 'component_recovery' | 'disassembly_output' | 'scrap';
  recovered_item_id?: string | null;
  recovered_item_name: string;
  source_quantity: number;
  recovered_quantity: number;
  unit?: string | null;
  quarantine_status: 'quarantined' | 'inspected_approved' | 'inspected_rejected' | 'released';
  condition: 'uninspected' | 'like_new' | 'good' | 'fair' | 'damaged_repairable' | 'scrap';
  reviewed_valuation?: number | null;
  valuation_notes?: string | null;
  attestation_notes?: string | null;
  quarantined_by: string;
  quarantined_by_username?: string | null;
  inspected_by?: string | null;
  inspected_by_username?: string | null;
  inspected_at?: string | null;
  created_at: string;
  updated_at: string;
}

export async function getSalvageRecoveries(filters?: { status?: string; project_id?: string }): Promise<SalvageRecovery[]> {
  const p = new URLSearchParams();
  if (filters?.status) p.append('status', filters.status);
  if (filters?.project_id) p.append('project_id', filters.project_id);
  const r = await apiFetch(`/items/salvage/recoveries?${p}`);
  if (!r.ok) throw new Error(await getApiErrorMessage(r, 'Failed to fetch salvage recoveries'));
  return r.json();
}

export async function createSalvageRecovery(data: Partial<SalvageRecovery>): Promise<SalvageRecovery> {
  const r = await apiFetch('/items/salvage/recoveries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(await getApiErrorMessage(r, 'Failed to record salvage recovery'));
  return r.json();
}

export async function inspectSalvageRecovery(id: string, data: { condition?: string; reviewed_valuation?: number; valuation_notes?: string; approval: 'approved' | 'rejected' }): Promise<SalvageRecovery> {
  const r = await apiFetch(`/items/salvage/recoveries/${id}/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(await getApiErrorMessage(r, 'Failed to inspect salvage recovery'));
  return r.json();
}

export async function releaseSalvageRecovery(id: string): Promise<SalvageRecovery> {
  const r = await apiFetch(`/items/salvage/recoveries/${id}/release`, { method: 'POST' });
  if (!r.ok) throw new Error(await getApiErrorMessage(r, 'Failed to release salvage recovery'));
  return r.json();
}
