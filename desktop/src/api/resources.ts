import { API_BASE } from '../lib/config';
import { apiFetch, apiUrl, getApiErrorMessage } from './http';
import { getToken, captureAccountSession, isAccountSessionCurrent, type AccountSession } from './auth';
import { invoke } from '@tauri-apps/api/tauri';
import { getDownloadJobs, getLocalMediaUrl } from './mediaDownloads';
import { isTauriRuntime } from '../lib/runtime';
import {pullResourcePosters} from './resource-posters';
import {stageResourceFile,stageResourceFolderFiles,stagePdfReplacement,refreshLocalFileAccess,localFileUrl,localFilePending} from './resource-uploads';

export interface Resource {
  local_file_pending?: boolean;
  local_file_available?: boolean;
  local_copy?: {state:string;verified_bytes:number;size_bytes:number|null;error?:string|null};
  id: string; name: string; kind: 'file' | 'folder' | 'link';
  file_type: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'document' | 'youtube' | 'other' | 'schematic_folder';
  original_filename?: string; mime_type?: string; size_bytes?: number; url?: string; thumbnail_url?: string;
  local_media_path?: string; local_media_filename?: string; local_media_mime_type?: string; local_media_size_bytes?: number; local_media_downloaded_at?: string;
  parent_resource_id?: string; relative_path?: string; item_id?: string; project_id?: string; note_id?: string;
  visibility?: 'lab' | 'project' | 'restricted';
  item_name?: string; project_name?: string; note_title?: string; category?: string; description?: string;
  tags?: string[]; updated_at?: string; created_at: string; derived_from_resource_id?: string;
}

export interface ResourceManifest { folder: string; files: Array<{ id: string; relative_path: string; original_filename: string; size_bytes: number; mime_type: string; }>; }
export interface ResourceAccessGrant { user_id:string; username?:string; access_level:'view'|'edit'; created_at?:string; created_by?:string|null; }

const localMediaResourceIds = new Set<string>();
let mediaAccount:string|null=null;
function rememberDesktopMedia(rows:Resource[],accountId:string,replace=false){
  if(replace||mediaAccount!==accountId)localMediaResourceIds.clear();
  mediaAccount=accountId;
  for(const row of rows){if(row.local_media_filename)localMediaResourceIds.add(row.id);else localMediaResourceIds.delete(row.id);}
}
export function isLocalResourceRuntime() { return isTauriRuntime(); }
async function localInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) throw new Error('Local LabOS runtime is unavailable');
  return invoke<T>(command, args);
}
async function cacheLocalResources(resources: Resource[], session: AccountSession | null) {
  if (!isAccountSessionCurrent(session)) return;
  try { await localInvoke('cache_local_resources', { resourcesJson: JSON.stringify(resources), expectedAccountId: session.accountId }); if(isAccountSessionCurrent(session))void pullResourcePosters(resources).catch(()=>{}); } catch {}
}


async function enrichWithDownloadedMedia(resources: Resource[]): Promise<Resource[]> {
  try {
    const jobs = await getDownloadJobs();
    const completed = new Map(jobs.filter(job => job.status === 'completed' && job.local_media_filename).map(job => [job.resource_id, job]));
    localMediaResourceIds.clear();
    return resources.map(resource => {
      const job = completed.get(resource.id);
      if (!job) return resource;
      localMediaResourceIds.add(resource.id);
      return { ...resource, local_media_filename: job.local_media_filename, local_media_size_bytes: job.local_media_size_bytes, local_media_downloaded_at: job.completed_at || job.updated_at || new Date().toISOString() };
    });
  } catch {
    return resources;
  }
}

export async function getResource(id: string): Promise<Resource> {
  if (isTauriRuntime()) {
    const session=captureAccountSession();
    if(!isAccountSessionCurrent(session))throw new Error('Sign in to read resources');
    const local=await localInvoke<Resource>('get_local_resource',{id});
    if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading resources');
    if(!local?.id)throw new Error('Resource is not available on this device');
    rememberDesktopMedia([local],session.accountId);
    return local;
  }
  const session = captureAccountSession();
  const response = await apiFetch(`/resources/${id}`);
  if (!response.ok) throw new Error('Failed to fetch resource');
  const resource = await response.json();
  await cacheLocalResources([resource], session);
  return (await enrichWithDownloadedMedia([resource]))[0];
}
export async function getAllResources(): Promise<Resource[]> {
  if (isTauriRuntime()) {
    return readDesktopResources();
  }
  const session = captureAccountSession();
  const response = await apiFetch('/resources');
  if (!response.ok) throw new Error('Failed to fetch resources');
  const resources = await response.json();
  await cacheLocalResources(resources, session);
  return enrichWithDownloadedMedia(resources);
}
export async function getResources(filters: { item_id?: string; project_id?: string; note_id?: string; parent_resource_id?: string }): Promise<Resource[]> {
  if (isTauriRuntime()) {
    return readDesktopResources({itemId:filters.item_id??null,projectId:filters.project_id??null,noteId:filters.note_id??null,parentResourceId:filters.parent_resource_id??null});
  }
  const params = new URLSearchParams(); if (filters.item_id) params.append('item_id', filters.item_id); if (filters.project_id) params.append('project_id', filters.project_id); if (filters.note_id) params.append('note_id', filters.note_id); if (filters.parent_resource_id) params.append('parent_resource_id', filters.parent_resource_id);
  const session = captureAccountSession();
  const response = await apiFetch(`/resources?${params}`); if (!response.ok) throw new Error('Failed to fetch resources');
  const resources = await response.json(); await cacheLocalResources(resources, session); return enrichWithDownloadedMedia(resources);
}
export async function getResourceManifest(id: string): Promise<ResourceManifest> {
  if(isTauriRuntime()){
    const session=captureAccountSession();
    if(!session)throw new Error('Sign in to read folder contents');
    const folder=await getResource(id);
    if(folder.kind!=='folder')throw new Error('Resource is not a folder');
    const children=await getResources({parent_resource_id:id});
    if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading folder contents');
    return {folder:folder.name,files:children.filter(r=>r.kind==='file').map(r=>({id:r.id,relative_path:r.relative_path||r.original_filename||r.name,original_filename:r.original_filename||r.name,size_bytes:r.size_bytes??0,mime_type:r.mime_type||'application/octet-stream'})).sort((a,b)=>a.relative_path.localeCompare(b.relative_path))};
  }
  const response=await apiFetch(`/resources/${id}/manifest`);if(!response.ok)throw new Error('Failed to fetch resource manifest');return response.json();
}
export function getResourceDownloadUrl(id: string, forceDownload = false): string { if(isTauriRuntime()){const local=localFileUrl(id);if(local)return local;} if (!forceDownload && localMediaResourceIds.has(id)) return getLocalMediaUrl(id); const token = getToken(); const params = new URLSearchParams(); if (forceDownload) params.set('download', 'true'); if (token) params.set('access_token', token); const query = params.toString(); return apiUrl(`/resources/${id}/download${query ? `?${query}` : ''}`); }
export async function getResourceAccessUrl(id: string, forceDownload = false): Promise<string> { const response = await apiFetch(`/resources/${id}/access-url`); if (!response.ok) throw new Error('Failed to create resource access URL'); const body = await response.json(); return `${body.url}${forceDownload ? (body.url.includes('?') ? '&' : '?') + 'download=true' : ''}`; }
export async function getResourceText(id: string, expectedRevision?:string): Promise<string> { if(isTauriRuntime())return localEditorCommand<string>('read_local_resource_markdown',id,{expectedRevision}); const response = await apiFetch(`/resource-editor/${id}/content`); if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to read resource content')); return response.text(); }
export async function saveResourceText(id: string, content: string, expectedRevision?:string): Promise<Resource> { if(isTauriRuntime()){if(!expectedRevision)throw new Error('Reopen the editor to verify the document revision');return localEditorCommand<Resource>('save_local_resource_markdown',id,{content,expectedRevision});} const response = await apiFetch(`/resource-editor/${id}/content`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }); if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to save resource content')); return response.json(); }
export async function getDocxHtml(id: string, expectedRevision?:string): Promise<{ html: string; messages: Array<{ type?: string; message?: string }> }> { if(isTauriRuntime())return localEditorCommand('read_local_docx',id,{expectedRevision}); const response = await apiFetch(`/resource-editor/${id}/docx`); if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to open DOCX')); return response.json(); }
export async function saveDocxCopy(id: string, html: string, expectedRevision?:string, requestId?:string): Promise<Resource> { if(isTauriRuntime()){if(!expectedRevision||!requestId)throw new Error('Reopen the editor to verify the document revision and save request');return localEditorCommand<Resource>('save_local_docx_copy',id,{html,expectedRevision,requestId});} const response = await apiFetch(`/resource-editor/${id}/docx-copy`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html }) }); if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to save DOCX copy')); return response.json(); }
export async function createPdfEditCopy(id: string): Promise<Resource> { if(isTauriRuntime())return localEditorCommand<Resource>('create_local_pdf_edit_copy',id); const response = await apiFetch(`/resource-editor/${id}/pdf-copy`, { method: 'POST' }); if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to create PDF edit copy')); return response.json(); }
export async function replaceResourceFile(id: string, file: File, expectedRevision?:string,onProgress?:(n:number)=>void): Promise<Resource> { if(isTauriRuntime())return stagePdfReplacement(id,file,expectedRevision||'',onProgress); const formData = new FormData(); formData.append('file', file); const response = await apiFetch(`/resource-editor/${id}/file`, { method: 'PUT', body: formData }); if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to replace resource file')); return response.json(); }

export async function openLocalPresentation(id:string):Promise<void>{
  return localEditorCommand<void>('open_local_presentation',id);
}

async function localEditorCommand<T>(command:string,id:string,args:Record<string,unknown>={}):Promise<T>{
  const session=captureAccountSession();
  if(!session||!isAccountSessionCurrent(session))throw new Error('Sign in before opening resource editors');
  const expectedSessionToken=await localInvoke<string>('local_authorization_guard',{expectedAccountId:session.accountId});
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while opening resource editor');
  const result=await localInvoke<T>(command,{...args,expectedAccountId:session.accountId,expectedSessionToken,resourceId:id});
  if(['create_local_pdf_edit_copy','save_local_resource_markdown','save_local_docx_copy'].includes(command)&&isAccountSessionCurrent(session))await refreshLocalFileAccess().catch(()=>undefined);
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while opening resource editor');
  return result;
}

export type MarkdownSavedVersion={change_id:string;size_bytes:number;created_at:string;status:'pending'|'confirmed'|'discarded'};
export async function listMarkdownSavedVersions(id:string):Promise<MarkdownSavedVersion[]>{
  if(!isTauriRuntime())return[];
  return localEditorCommand<MarkdownSavedVersion[]>('list_local_markdown_versions',id);
}
export async function readMarkdownSavedVersion(id:string,changeId:string):Promise<string>{
  if(!isTauriRuntime())throw new Error('Saved versions are available only on the authoring PC');
  return localEditorCommand<string>('read_local_markdown_version',id,{changeId});
}

export async function uploadFile(file: File, parent: { item_id?: string; project_id?: string; note_id?: string; parent_resource_id?: string }, name?: string, onProgress?: (progress: number) => void, metadata?: { category?: string; description?: string; tags?: string[] }): Promise<Resource> {
  if(isTauriRuntime())return stageResourceFile(file,{...parent,name,...metadata},onProgress);
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('File uploads require a connection to the central LabOS backend. Add a link instead, or reconnect and try again.');
  const formData = new FormData(); formData.append('file', file); if (name) formData.append('name', name); if (parent.item_id) formData.append('item_id', parent.item_id); if (parent.project_id) formData.append('project_id', parent.project_id); if (parent.note_id) formData.append('note_id', parent.note_id);
  if (metadata?.category) formData.append('category', metadata.category); if (metadata?.description) formData.append('description', metadata.description); if (metadata?.tags) formData.append('tags', JSON.stringify(metadata.tags));
  const session=captureAccountSession();
  return new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.timeout = 120000; xhr.upload.addEventListener('progress', e => { if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100); }); xhr.addEventListener('load', async () => { if (xhr.status === 201) { try { const resource = JSON.parse(xhr.responseText) as Resource; await cacheLocalResources([resource],session); resolve(resource); } catch (e) { reject(e instanceof Error ? e : new Error('Failed to cache uploaded resource')); } } else reject(new Error('Failed to upload file')); }); xhr.addEventListener('error', () => reject(new Error('Upload failed — could not reach the server. Is the backend running?'))); xhr.addEventListener('timeout', () => reject(new Error('Upload timed out after 2 minutes — check the backend server console for an error.'))); xhr.addEventListener('abort', () => reject(new Error('Upload was cancelled'))); xhr.open('POST', `${API_BASE}/resources`); const token = getToken(); if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`); xhr.send(formData); });
}
export async function createFolder(name: string, parent: { item_id?: string; project_id?: string; note_id?: string; parent_resource_id?: string }): Promise<Resource> {
  if (isTauriRuntime()) {
    return localInvoke<Resource>('create_local_resource_folder', { name, itemId:parent.item_id??null,projectId:parent.project_id??null,noteId:parent.note_id??null,parentResourceId:parent.parent_resource_id??null });
  }
  const response = await apiFetch('/resources/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ...parent }) });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to create folder'));
  return response.json();
}
export async function uploadFolderFiles(folderId: string, files: File[], relativePaths: string[], onProgress?: (progress: number) => void): Promise<Resource[]> { if(isTauriRuntime())return stageResourceFolderFiles(folderId,files,relativePaths,onProgress); const formData = new FormData(); files.forEach(file => formData.append('files', file)); formData.append('relative_paths', JSON.stringify(relativePaths)); return new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.timeout = 120000; xhr.upload.addEventListener('progress', e => { if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100); }); xhr.addEventListener('load', () => { if (xhr.status === 201) resolve(JSON.parse(xhr.responseText)); else reject(new Error('Failed to upload folder files')); }); xhr.addEventListener('error', () => reject(new Error('Upload failed — could not reach the server. Is the backend running?'))); xhr.addEventListener('timeout', () => reject(new Error('Upload timed out after 2 minutes'))); xhr.addEventListener('abort', () => reject(new Error('Upload was cancelled'))); xhr.open('POST', `${API_BASE}/resources/${folderId}/files`); const token = getToken(); if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`); xhr.send(formData); }); }
export async function createLink(url: string, parent: { item_id?: string; project_id?: string; note_id?: string }, name?: string, metadata?: { category?: string; description?: string; tags?: string[] }): Promise<Resource> {
  if (isTauriRuntime()) {
    return localInvoke<Resource>('create_local_resource_link', { url, name, itemId:parent.item_id??null, projectId:parent.project_id??null, noteId:parent.note_id??null, ...metadata });
  }
  const response = await apiFetch('/resources/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, name, ...parent, ...metadata }) });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to create link'));
  return response.json();
}
export async function attachExistingResource(id: string, destination: {item_id?:string|null;project_id?:string|null;note_id?:string|null}): Promise<Resource> {
  const session=captureAccountSession();
  if(isTauriRuntime()){
    if(!session||!isAccountSessionCurrent(session))throw new Error('Sign in before moving resources');
    const expectedSessionToken=await localInvoke<string>('local_authorization_guard',{expectedAccountId:session.accountId});
    if(!isAccountSessionCurrent(session))throw new Error('Account changed while moving resource');
    const resource=await localInvoke<Resource>('move_local_resource_attachment',{
      expectedAccountId:session.accountId,expectedSessionToken,resourceId:id,destination,
    });
    if(!isAccountSessionCurrent(session))throw new Error('Account changed while moving resource');
    return resource;
  }
  const response=await apiFetch(`/resources/${encodeURIComponent(id)}/attachment`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(destination)});
  if(!response.ok)throw new Error(await getApiErrorMessage(response,'Unable to attach resource'));
  const resource:Resource=await response.json();
  await cacheLocalResources([resource],session);
  return resource;
}
export async function updateResourceMetadata(id: string, metadata: { category?: string; description?: string; tags?: string[] }): Promise<Resource> {
  if (isTauriRuntime()) {
    const session=captureAccountSession();
    if(!session||!isAccountSessionCurrent(session))throw new Error('Sign in before editing resource metadata');
    const status=await localInvoke<{resource_mutation_protocol?:number}>('local_database_status');
    if(status?.resource_mutation_protocol!==1)throw new Error('Resource metadata editing requires an updated desktop build');
    const expectedSessionToken=await localInvoke<string>('local_authorization_guard',{expectedAccountId:session.accountId});
    if(!isAccountSessionCurrent(session))throw new Error('Account changed while editing resource metadata');
    const resource=await localInvoke<Resource>('update_local_resource_metadata', { id, ...metadata,expectedAccountId:session.accountId,expectedSessionToken });
    if(!isAccountSessionCurrent(session))throw new Error('Account changed while editing resource metadata');
    return resource;
  }
  const response = await apiFetch(`/resources/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to update resource metadata'));
  return response.json();
}
async function readDesktopResources(filters?:Record<string,unknown>):Promise<Resource[]>{
  const session=captureAccountSession();
  if(!isAccountSessionCurrent(session))throw new Error('Sign in to read resources');
  const rows=await localInvoke<Resource[]>('list_local_resources',filters);
  // File capability failure must not hide otherwise available SQLite metadata.
  await refreshLocalFileAccess().catch(()=>undefined);
  const copies:Record<string,NonNullable<Resource['local_copy']>>=await localInvoke<Record<string,NonNullable<Resource['local_copy']>>>('local_resource_copy_status',{expectedAccountId:session.accountId}).catch(()=>({}));
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading resources');
  if(!Array.isArray(rows))throw new Error('Local resource list is unavailable');
  rememberDesktopMedia(rows,session.accountId,!filters);
  // Synced resource records already contain media metadata. Reading them must
  // neither wait for server job enrichment nor hide a failed native read.
  return rows.map(row=>({...row,local_file_pending:localFilePending(row.id),local_file_available:!!localFileUrl(row.id),local_copy:copies[row.id]}));
}
export async function updateResourceVisibility(id:string,visibility:NonNullable<Resource['visibility']>):Promise<Resource>{
  const response=await apiFetch(`/resources/${encodeURIComponent(id)}/visibility`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({visibility})});
  if(!response.ok)throw new Error(await getApiErrorMessage(response,'Failed to update resource visibility'));
  return response.json();
}
export async function getResourceAccessGrants(id:string):Promise<ResourceAccessGrant[]>{
  const response=await apiFetch(`/resources/${encodeURIComponent(id)}/access-grants`);
  if(!response.ok)throw new Error(await getApiErrorMessage(response,'Failed to load resource access grants'));
  return response.json();
}
export async function setResourceAccessGrant(id:string,userId:string,access_level:ResourceAccessGrant['access_level']):Promise<ResourceAccessGrant>{
  const response=await apiFetch(`/resources/${encodeURIComponent(id)}/access-grants/${encodeURIComponent(userId)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_level})});
  if(!response.ok)throw new Error(await getApiErrorMessage(response,'Failed to save resource access grant'));
  return response.json();
}
export async function removeResourceAccessGrant(id:string,userId:string):Promise<void>{
  const response=await apiFetch(`/resources/${encodeURIComponent(id)}/access-grants/${encodeURIComponent(userId)}`,{method:'DELETE'});
  if(!response.ok)throw new Error(await getApiErrorMessage(response,'Failed to remove resource access grant'));
}
export async function deleteResource(id: string): Promise<void> {
  if (isTauriRuntime()) { await localInvoke('delete_local_resource', { id }); return; }
  const response = await apiFetch(`/resources/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to delete resource'));
}
