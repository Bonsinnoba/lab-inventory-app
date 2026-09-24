import { apiFetch } from './http';
import { invoke } from '@tauri-apps/api/tauri';
const isTauri=()=>typeof window!=='undefined'&&Boolean((window as any).__TAURI_IPC__);

export interface FundingSource {
  id: string;
  name: string;
  source_type: 'donor' | 'investor' | 'grant_body' | 'institutional' | 'other';
  contact_info?: string;
  notes?: string;
  created_at: string;
  total_contributed?: number;
}

export async function getFundingSources(): Promise<FundingSource[]> { if(isTauri())try{return await invoke<FundingSource[]>('get_local_funding_sources')}catch(error){throw new Error('Local finance access failed: '+String(error))} const response=await apiFetch('/funding-sources');if(!response.ok)throw new Error('Failed to fetch');return response.json(); }

export async function createFundingSource(value:any):Promise<FundingSource>{if(isTauri()){return await invoke<FundingSource>('create_local_funding_source',{source:value})} const response=await apiFetch('/funding-sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(!response.ok)throw new Error('Failed to create');return response.json();}

export async function updateFundingSource(id:string,value:any):Promise<FundingSource>{if(isTauri()){return await invoke<FundingSource>('update_local_funding_source',{id,source:value})} const response=await apiFetch(`/funding-sources/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(!response.ok)throw new Error('Failed to update');return response.json();}

export async function deleteFundingSource(id:string):Promise<void>{if(isTauri()){await invoke('delete_local_funding_source',{id});return} const response=await apiFetch(`/funding-sources/${id}`,{method:'DELETE'});if(!response.ok)throw new Error('Failed to delete');}
