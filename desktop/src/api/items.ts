import { apiFetch } from './http';

export interface Item {
  id: string;
  name: string;
  type: string;
  status: 'available' | 'in_use' | 'damaged' | 'needs_repair' | 'needs_replacement' | 'low_stock' | 'retired';
  location_id?: string;
  current_quantity: number;
  initial_quantity: number;
  unit?: string;
  sku?: string;
  category?: string;
  dimensions?: string;
  unit_cost?: number;
  replacement_cost?: number;
  condition_notes?: string;
  next_maintenance_date?: string | null;
  maintenance_interval_days?: number | null;
  // The item's picture — set explicitly via the "Add/Change picture"
  // control, independent of any other resources/files attached to
  // this item (null if none has been set).
  image_resource_id?: string | null;
  manufacturer?: string | null;
  model_number?: string | null;
  serial_number?: string | null;
  asset_tag?: string | null;
  calibration_interval_days?: number | null;
  next_calibration_date?: string | null;
  assigned_to?: string | null;
  assigned_to_username?: string | null;
  supplier?: string | null;
  part_number?: string | null;
  created_at: string;
  updated_at: string;
}

export async function getItems(filters?: {
  type?: string;
  status?: string;
  location_id?: string;
  low_stock?: boolean;
}): Promise<Item[]> {
  const params = new URLSearchParams();
  if (filters?.type) params.append('type', filters.type);
  if (filters?.status) params.append('status', filters.status);
  if (filters?.location_id) params.append('location_id', filters.location_id);
  if (filters?.low_stock) params.append('low_stock', 'true');
  
  const response = await apiFetch(`/items?${params}`);
  if (!response.ok) throw new Error('Failed to fetch items');
  return response.json();
}

export async function getItem(id: string): Promise<Item> {
  const response = await apiFetch(`/items/${id}`);
  if (!response.ok) throw new Error('Failed to fetch item');
  return response.json();
}

export interface ItemHistoryEntry {
  id: string;
  item_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

export async function getItemHistory(id: string): Promise<ItemHistoryEntry[]> {
  const response = await apiFetch(`/items/${id}/history`);
  if (!response.ok) throw new Error('Failed to fetch item history');
  return response.json();
}

export interface ItemAssignmentHistoryEntry {
  id: string;
  action: string;
  old_assignee_username?: string | null;
  new_assignee_username?: string | null;
  actor_username?: string | null;
  created_at: string;
}

export async function getItemAssignmentHistory(id: string): Promise<ItemAssignmentHistoryEntry[]> {
  const response = await apiFetch(`/items/${id}/assignment-history`);
  if (!response.ok) throw new Error('Failed to fetch assignment history');
  return response.json();
}

// Looks up an item by exact SKU match -- this is what powers barcode
// scanning. A keyboard-wedge barcode scanner just types the scanned
// code (plus Enter) into whatever input is focused, so any text input
// wired to call this on submit effectively becomes a scan target.
export async function getItemBySku(sku: string): Promise<Item> {
  const response = await apiFetch(`/items/by-sku/${encodeURIComponent(sku)}`);
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Item not found');
  return response.json();
}

export async function createItem(item: Omit<Item, 'id' | 'created_at' | 'updated_at'>): Promise<Item> {
  const response = await apiFetch(`/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!response.ok) throw new Error('Failed to create item');
  return response.json();
}

export async function updateItem(id: string, item: Partial<Item>): Promise<Item> {
  const response = await apiFetch(`/items/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!response.ok) throw new Error('Failed to update item');
  return response.json();
}

export async function deleteItem(id: string): Promise<void> {
  const response = await apiFetch(`/items/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete item');
}

export async function bulkUpdateItemStatus(ids: string[], status: Item['status']): Promise<{ updated: number }> {
  const response = await apiFetch(`/items/bulk-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, status }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Failed to update items');
  return response.json();
}

export async function bulkDeleteItems(ids: string[]): Promise<{ deleted: number }> {
  const response = await apiFetch(`/items/bulk-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Failed to delete items');
  return response.json();
}

export type MovementType = 'receive' | 'checkout' | 'return' | 'consume' | 'adjust' | 'transfer' | 'damage' | 'loss' | 'repair_out' | 'repair_in';

export interface ItemMovement {
  id: string;
  item_id: string;
  movement_type: MovementType;
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  from_location_id?: string | null;
  to_location_id?: string | null;
  from_location_name?: string | null;
  to_location_name?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  reason?: string | null;
  reference?: string | null;
  performed_by?: string | null;
  performed_by_username?: string | null;
  created_at: string;
}

export interface MaintenanceRecord {
  id: string;
  item_id: string;
  maintenance_type: 'routine' | 'repair' | 'inspection' | 'calibration' | 'cleaning' | 'other';
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  scheduled_date?: string | null;
  completed_date?: string | null;
  performed_by?: string | null;
  performed_by_username?: string | null;
  notes?: string | null;
  cost?: number | null;
  created_at: string;
}

export async function getItemMovements(id: string): Promise<ItemMovement[]> {
  const response = await apiFetch(`/items/${id}/movements`);
  if (!response.ok) throw new Error('Failed to fetch item movements');
  return response.json();
}

export async function createItemMovement(id: string, movement: {
  movement_type: MovementType;
  quantity: number;
  to_location_id?: string;
  project_id?: string;
  reason?: string;
  reference?: string;
}): Promise<{ item: Item; movement: ItemMovement }> {
  const response = await apiFetch(`/items/${id}/movements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(movement),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.error || 'Failed to record movement');
  return body;
}

export async function getMaintenanceRecords(id: string): Promise<MaintenanceRecord[]> {
  const response = await apiFetch(`/items/${id}/maintenance`);
  if (!response.ok) throw new Error('Failed to fetch maintenance records');
  return response.json();
}

export async function createMaintenanceRecord(id: string, record: Partial<MaintenanceRecord>): Promise<MaintenanceRecord> {
  const response = await apiFetch(`/items/${id}/maintenance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.error || 'Failed to create maintenance record');
  return body;
}

export async function updateMaintenanceRecord(itemId: string, maintenanceId: string, record: Partial<MaintenanceRecord>): Promise<MaintenanceRecord> {
  const response = await apiFetch(`/items/${itemId}/maintenance/${maintenanceId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.error || 'Failed to update maintenance record');
  return body;
}

export async function deleteMaintenanceRecord(itemId: string, maintenanceId: string): Promise<void> {
  const response = await apiFetch(`/items/${itemId}/maintenance/${maintenanceId}`, { method: 'DELETE' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.error || 'Failed to delete maintenance record');
}

