import { apiFetch } from './http';

export interface KnowledgeOverview {
  counts: { notes: number; resources: number };
  categories: Array<{ category: string; count: number }>;
  recent_notes: Array<{ id: string; title: string; tags: string[]; updated_at: string; author_id?: string }>;
  recent_resources: Array<{ id: string; name: string; kind: string; file_type: string; category: string; tags: string[]; updated_at: string }>;
}

export interface KnowledgeTag { tag: string; note_count: number; resource_count: number }

export async function getKnowledgeOverview(): Promise<KnowledgeOverview> {
  const response = await apiFetch('/knowledge/overview');
  if (!response.ok) throw new Error('Failed to load knowledge overview');
  return response.json();
}

export async function getKnowledgeTags(): Promise<KnowledgeTag[]> {
  const response = await apiFetch('/knowledge/tags');
  if (!response.ok) throw new Error('Failed to load knowledge tags');
  return response.json();
}

export interface Finding { id:string; project_id?:string|null; experiment_id?:string|null; title:string; body:string; status:string; confidence?:number|string|null; tags:string[]; created_at:string; updated_at:string; }
export interface LabResult { id:string; project_id?:string|null; experiment_id?:string|null; finding_id?:string|null; title:string; summary:string; value_numeric?:number|string|null; value_text?:string|null; unit:string; created_at:string; updated_at:string; }
export interface KnowledgeRelationship { id:string; project_id?:string|null; source_type:string; source_id:string; target_type:string; target_id:string; relationship:string; created_at:string; }
const parseKnowledge=async(r:Response,f:string)=>{if(!r.ok){const x=await r.json().catch(()=>null);throw new Error(x?.error?.message||x?.error||f)}return r.status===204?undefined:r.json()};
export const getFindings=async(q='')=>parseKnowledge(await apiFetch(`/knowledge/findings${q?`?q=${encodeURIComponent(q)}`:''}`),'Failed to load findings');
export const createFinding=async(data:any)=>parseKnowledge(await apiFetch('/knowledge/findings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),'Failed to create finding');
export const updateFinding=async(id:string,data:any)=>parseKnowledge(await apiFetch(`/knowledge/findings/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),'Failed to update finding');
export const deleteFinding=async(id:string)=>parseKnowledge(await apiFetch(`/knowledge/findings/${id}`,{method:'DELETE'}),'Failed to delete finding');
export const getResults=async(q='')=>parseKnowledge(await apiFetch(`/knowledge/results${q?`?q=${encodeURIComponent(q)}`:''}`),'Failed to load results');
export const createResult=async(data:any)=>parseKnowledge(await apiFetch('/knowledge/results',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),'Failed to create result');
export const updateResult=async(id:string,data:any)=>parseKnowledge(await apiFetch(`/knowledge/results/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),'Failed to update result');
export const deleteResult=async(id:string)=>parseKnowledge(await apiFetch(`/knowledge/results/${id}`,{method:'DELETE'}),'Failed to delete result');
export const getKnowledgeRelationships=async()=>parseKnowledge(await apiFetch('/knowledge/relationships'),'Failed to load relationships');
export const createKnowledgeRelationship=async(data:any)=>parseKnowledge(await apiFetch('/knowledge/relationships',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),'Failed to create relationship');
export const deleteKnowledgeRelationship=async(id:string)=>parseKnowledge(await apiFetch(`/knowledge/relationships/${id}`,{method:'DELETE'}),'Failed to delete relationship');
export const searchKnowledge=async(q:string)=>parseKnowledge(await apiFetch(`/knowledge/search?q=${encodeURIComponent(q)}`),'Knowledge search failed');
