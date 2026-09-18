import { invoke } from '@tauri-apps/api/tauri';
import { apiFetch } from './http';
const isTauri=()=>typeof window!=='undefined'&&!!(window as any).__TAURI_IPC__;
async function local<T>(command:string,args:Record<string,unknown>={}):Promise<T|null>{if(!isTauri())return null;return invoke<T>(command,args);}
export interface Location{id:string;name:string;type?:string;parent_id?:string|null;item_count?:number;created_at:string;}
export async function getLocations():Promise<Location[]>{const x=await local<Location[]>('list_local_locations');if(x!==null)return x;const r=await apiFetch('/locations');if(!r.ok)throw new Error('Failed to fetch locations');return r.json();}
export async function getLocation(id:string):Promise<Location>{const x=await local<Location|null>('get_local_location',{id});if(x!==null){if(!x)throw new Error('Location not found');return x;}const r=await apiFetch(`/locations/${id}`);if(!r.ok)throw new Error('Failed to fetch location');return r.json();}
export async function createLocation(data:{name:string;parent_id?:string|null}):Promise<Location>{const x=await local<Location>('create_local_location',{data});if(x!==null)return x;const r=await apiFetch('/locations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw new Error('Failed to create location');return r.json();}
export async function updateLocation(id:string,data:Partial<Location>):Promise<Location>{const x=await local<Location>('update_local_location',{id,patch:data});if(x!==null)return x;const r=await apiFetch(`/locations/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw new Error('Failed to update location');return r.json();}
export async function deleteLocation(id:string):Promise<void>{const x=await local<void>('delete_local_location',{id});if(x!==null)return;const r=await apiFetch(`/locations/${id}`,{method:'DELETE'});if(!r.ok)throw new Error('Failed to delete location');}
