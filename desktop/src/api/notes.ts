import { invoke } from '@tauri-apps/api/tauri';
import { apiFetch, getApiErrorMessage } from './http';

function isTauriRuntime(): boolean { return typeof window !== 'undefined' && !!(window as any).__TAURI_IPC__; }
async function localInvoke<T>(command:string,args:Record<string,unknown>={}):Promise<T|null>{if(!isTauriRuntime())return null;return invoke<T>(command,args);}

export interface Note { id:string; title:string; body:string; tags:string[]; item_id?:string; project_id?:string; author_id?:string; created_at:string; updated_at:string; }
export async function getNotes(filters?:{item_id?:string;project_id?:string;tag?:string;search?:string;}):Promise<Note[]>{
  const local=await localInvoke<Note[]>('list_local_notes',{filters:filters??{}});
  if(local!==null)return local;
  const params=new URLSearchParams(); if(filters?.item_id)params.append('item_id',filters.item_id); if(filters?.project_id)params.append('project_id',filters.project_id); if(filters?.tag)params.append('tag',filters.tag); if(filters?.search)params.append('search',filters.search);
  const response=await apiFetch(`/notes?${params}`); if(!response.ok)throw new Error(await getApiErrorMessage(response,'Failed to fetch notes')); return response.json();
}
export async function getAllTags():Promise<string[]>{const local=await localInvoke<string[]>('get_local_note_tags');if(local!==null)return local;const response=await apiFetch('/notes/tags/all');if(!response.ok)throw new Error(await getApiErrorMessage(response,'Failed to fetch tags'));return response.json();}
export async function getNote(id:string):Promise<Note>{const local=await localInvoke<Note|null>('get_local_note',{noteId:id});if(local!==null){if(!local)throw new Error('Note not found');return local;}const response=await apiFetch(`/notes/${id}`);if(!response.ok)throw new Error(await getApiErrorMessage(response,'Failed to fetch note'));return response.json();}
export async function createNote(note:Omit<Note,'id'|'created_at'|'updated_at'>):Promise<Note>{const local=await localInvoke<Note>('create_local_note',{note});if(local!==null)return local;const response=await apiFetch('/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(note)});if(!response.ok)throw new Error(await getApiErrorMessage(response,'Failed to create note'));return response.json();}
export async function updateNote(id:string,note:Partial<Note>):Promise<Note>{const local=await localInvoke<Note>('update_local_note',{noteId:id,patch:note});if(local!==null)return local;const response=await apiFetch(`/notes/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(note)});if(!response.ok)throw new Error(await getApiErrorMessage(response,'Failed to update note'));return response.json();}
export async function deleteNote(id:string):Promise<void>{const local=await localInvoke<void>('delete_local_note',{noteId:id});if(local!==null)return;const response=await apiFetch(`/notes/${id}`,{method:'DELETE'});if(!response.ok)throw new Error(await getApiErrorMessage(response,'Failed to delete note'));}
export interface NoteRevision {id:string;note_id:string;title:string;body:string;tags:string[];edited_by?:string|null;editor?:string|null;created_at:string;}
export async function getNoteRevisions(id:string):Promise<NoteRevision[]>{const local=await localInvoke<NoteRevision[]>('get_local_note_revisions',{noteId:id});if(local!==null)return local;const r=await apiFetch(`/notes/${id}/revisions`);if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to fetch note revisions'));return r.json();}
export async function restoreNoteRevision(id:string,revisionId:string):Promise<Note>{const local=await localInvoke<Note>('restore_local_note_revision',{noteId:id,revisionId});if(local!==null)return local;const r=await apiFetch(`/notes/${id}/revisions/${revisionId}/restore`,{method:'POST'});if(!r.ok)throw new Error(await getApiErrorMessage(r,'Failed to restore note revision'));return r.json();}
