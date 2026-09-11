import { apiFetch, getApiErrorMessage } from './http';

export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  item_id?: string;
  project_id?: string;
  author_id?: string;
  created_at: string;
  updated_at: string;
}

export async function getNotes(filters?: {
  item_id?: string;
  project_id?: string;
  tag?: string;
  search?: string;
}): Promise<Note[]> {
  const params = new URLSearchParams();
  if (filters?.item_id) params.append('item_id', filters.item_id);
  if (filters?.project_id) params.append('project_id', filters.project_id);
  if (filters?.tag) params.append('tag', filters.tag);
  if (filters?.search) params.append('search', filters.search);
  
  const response = await apiFetch(`/notes?${params}`);
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to fetch notes'));
  return response.json();
}

export async function getAllTags(): Promise<string[]> {
  const response = await apiFetch(`/notes/tags/all`);
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to fetch tags'));
  return response.json();
}

export async function getNote(id: string): Promise<Note> {
  const response = await apiFetch(`/notes/${id}`);
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to fetch note'));
  return response.json();
}

export async function createNote(note: Omit<Note, 'id' | 'created_at' | 'updated_at'>): Promise<Note> {
  const response = await apiFetch(`/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note),
  });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to create note'));
  return response.json();
}

export async function updateNote(id: string, note: Partial<Note>): Promise<Note> {
  const response = await apiFetch(`/notes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note),
  });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to update note'));
  return response.json();
}

export async function deleteNote(id: string): Promise<void> {
  const response = await apiFetch(`/notes/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to delete note'));
}

export interface NoteRevision { id:string; note_id:string; title:string; body:string; tags:string[]; edited_by?:string|null; editor?:string|null; created_at:string; }
export async function getNoteRevisions(id:string):Promise<NoteRevision[]>{const r=await apiFetch(`/notes/${id}/revisions`);if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to fetch note revisions'));return r.json();}
export async function restoreNoteRevision(id:string,revisionId:string):Promise<Note>{const r=await apiFetch(`/notes/${id}/revisions/${revisionId}/restore`,{method:'POST'});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to restore note revision'));return r.json();}
