import { invoke } from '@tauri-apps/api/tauri';
import { apiFetch } from './http';

const isTauri=()=>typeof window!=='undefined'&&!!(window as any).__TAURI_IPC__;
async function local<T>(command:string,args:Record<string,unknown>={}):Promise<T|null>{if(!isTauri())return null;return invoke<T>(command,args);}

export interface KnowledgeOverview {
  counts: { notes: number; resources: number };
  categories: Array<{ category: string; count: number }>;
  recent_notes: Array<{ id: string; title: string; tags: string[]; updated_at: string; author_id?: string }>;
  recent_resources: Array<{ id: string; name: string; kind: string; file_type: string; category: string; tags: string[]; updated_at: string }>;
}

export interface KnowledgeTag { tag: string; note_count: number; resource_count: number }

export async function getKnowledgeOverview(): Promise<KnowledgeOverview> { const x=await local<KnowledgeOverview>('get_local_knowledge_overview'); if(x!==null)return x;
  const response = await apiFetch('/knowledge/overview');
  if (!response.ok) throw new Error('Failed to load knowledge overview');
  return response.json();
}

export async function getKnowledgeTags(): Promise<KnowledgeTag[]> { const x=await local<KnowledgeTag[]>('get_local_knowledge_tags'); if(x!==null)return x;
  const response = await apiFetch('/knowledge/tags');
  if (!response.ok) throw new Error('Failed to load knowledge tags');
  return response.json();
}

export interface Finding { id:string; project_id?:string|null; experiment_id?:string|null; title:string; body:string; status:string; confidence?:number|string|null; tags:string[]; created_at:string; updated_at:string; }
export interface LabResult { id:string; project_id?:string|null; experiment_id?:string|null; finding_id?:string|null; title:string; summary:string; value_numeric?:number|string|null; value_text?:string|null; unit:string; created_at:string; updated_at:string; }
export interface KnowledgeRelationship { id:string; project_id?:string|null; source_type:string; source_id:string; target_type:string; target_id:string; relationship:string; created_at:string; }
const parseKnowledge=async(r:Response,f:string)=>{if(!r.ok){const x=await r.json().catch(()=>null);throw new Error(x?.error?.message||x?.error||f)}return r.status===204?undefined:r.json()};
export const getFindings=async(q='')=>{const x=await local<any[]>('get_local_knowledge_findings',{q});if(x!==null)return x;return parseKnowledge(await apiFetch(`/knowledge/findings${q?`?q=${encodeURIComponent(q)}`:''}`),'Failed to load findings');
export const createFinding=async(data:any)=>{const x=await local<any>('create_local_knowledge_finding',{data});if(x!==null)return x;return parseKnowledge(await apiFetch('/knowledge/findings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),'Failed to create finding');
export const updateFinding=async(id:string,data:any)=>{const x=await local<any>('update_local_knowledge_finding',{id,patch:data});if(x!==null)return x;return parseKnowledge(await apiFetch(`/knowledge/findings/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),'Failed to update finding');
export const deleteFinding=async(id:string)=>{const x=await local<void>('delete_local_knowledge_finding',{id});if(x!==null)return x;return parseKnowledge(await apiFetch(`/knowledge/findings/${id}`,{method:'DELETE'}),'Failed to delete finding');
export const getResults=async(q='')=>{const x=await local<any[]>('get_local_knowledge_results',{q});if(x!==null)return x;return parseKnowledge(await apiFetch(`/knowledge/results${q?`?q=${encodeURIComponent(q)}`:''}`),'Failed to load results');
export const createResult=async(data:any)=>{const x=await local<any>('create_local_knowledge_result',{data});if(x!==null)return x;return parseKnowledge(await apiFetch('/knowledge/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),'Failed to create result');
export const updateResult=async(id:string,data:any)=>{const x=await local<any>('update_local_knowledge_result',{id,patch:data});if(x!==null)return x;return parseKnowledge(await apiFetch(`/knowledge/results/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),'Failed to update result');
export const deleteResult=async(id:string)=>{const x=await local<void>('delete_local_knowledge_result',{id});if(x!==null)return x;return parseKnowledge(await apiFetch(`/knowledge/results/${id}`,{method:'DELETE'}),'Failed to delete result');
export const getKnowledgeRelationships=async()=>{const x=await local<any[]>('get_local_knowledge_relationships');if(x!==null)return x;return parseKnowledge(await apiFetch('/knowledge/relationships'),'Failed to load relationships');
export const createKnowledgeRelationship=async(data:any)=>{const x=await local<any>('create_local_knowledge_relationship',{data});if(x!==null)return x;return parseKnowledge(await apiFetch('/knowledge/relationships',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),'Failed to create relationship');
export const deleteKnowledgeRelationship=async(id:string)=>{const x=await local<void>('delete_local_knowledge_relationship',{id});if(x!==null)return x;return parseKnowledge(await apiFetch(`/knowledge/relationships/${id}`,{method:'DELETE'}),'Failed to delete relationship');
export const searchKnowledge=async(q:string)=>{const x=await local<any>('search_local_knowledge',{q});if(x!==null)return x;return parseKnowledge(await apiFetch(`/knowledge/search?q=${encodeURIComponent(q)}`),'Knowledge search failed');
