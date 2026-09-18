import { API_BASE } from '../lib/config';
import { apiFetch, apiUrl, getApiErrorMessage } from './http';
import { getToken } from './auth';
import { invoke } from '@tauri-apps/api/tauri';
import { getDownloadJobs, getLocalMediaUrl } from './mediaDownloads';

export interface Resource {
  id: string; name: string; kind: 'file' | 'folder' | 'link';
  file_type: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'document' | 'youtube' | 'other' | 'schematic_folder';
  original_filename?: string; mime_type?: string; size_bytes?: number; url?: string; thumbnail_url?: string;
  local_media_path?: string; local_media_filename?: string; local_media_mime_type?: string; local_media_size_bytes?: number; local_media_downloaded_at?: string;
  parent_resource_id?: string; relative_path?: string; item_id?: string; project_id?: string; note_id?: string;
  item_name?: string; project_name?: string; note_title?: string; category?: string; description?: string;
  tags?: string[]; updated_at?: string; created_at: string; derived_from_resource_id?: string;
}

export interface ResourceManifest { folder: string; files: Array<{ id: string; relative_path: string; original_filename: string; size_bytes: number; mime_type: string; }>; }

const localMediaResourceIds = new Set<string>();
function isTauriRuntime() { return typeof window !== 'undefined' && Boolean((window as any).__TAURI_IPC__); }
export function isLocalResourceRuntime() { return isTauriRuntime(); }
async function localInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) throw new Error('Local LabOS runtime is unavailable');
  return invoke<T>(command, args);
}
async function cacheLocalResources(resources: Resource[]) {
  try { await localInvoke('cache_local_resources', { resourcesJson: JSON.stringify(resources) }); } catch {}
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
    try {
      const local = await localInvoke<Resource>('get_local_resource', { id });
      return (await enrichWithDownloadedMedia([local]))[0];
    } catch {}
  }
  const response = await apiFetch(`/resources/${id}`);
  if (!response.ok) throw new Error('Failed to fetch resource');
  const resource = await response.json();
  await cacheLocalResources([resource]);
  return (await enrichWithDownloadedMedia([resource]))[0];
}
export async function getAllResources(): Promise<Resource[]> {
  if (isTauriRuntime()) {
    try {
      const local = await localInvoke<Resource[]>('list_local_resources');
      return enrichWithDownloadedMedia(local);
    } catch {}
  }
  const response = await apiFetch('/resources');
  if (!response.ok) throw new Error('Failed to fetch resources');
  const resources = await response.json();
  await cacheLocalResources(resources);
  return enrichWithDownloadedMedia(resources);
}
export async function getResources(filters: { item_id?: string; project_id?: string; note_id?: string; parent_resource_id?: string }): Promise<Resource[]> {
  if (isTauriRuntime()) {
    try {
      const local = await localInvoke<Resource[]>('list_local_resources', filters);
      return enrichWithDownloadedMedia(local);
    } catch {}
  }
  const params = new URLSearchParams(); if (filters.item_id) params.append('item_id', filters.item_id); if (filters.project_id) params.append('project_id', filters.project_id); if (filters.note_id) params.append('note_id', filters.note_id); if (filters.parent_resource_id) params.append('parent_resource_id', filters.parent_resource_id);
  const response = await apiFetch(`/resources?${params}`); if (!response.ok) throw new Error('Failed to fetch resources');
  const resources = await response.json(); await cacheLocalResources(resources); return enrichWithDownloadedMedia(resources);
}
export async function getResourceManifest(id: string): Promise<ResourceManifest> { const response = await apiFetch(`/resources/${id}/manifest`); if (!response.ok) throw new Error('Failed to fetch resource manifest'); return response.json(); }
export function getResourceDownloadUrl(id: string, forceDownload = false): string { if (!forceDownload && localMediaResourceIds.has(id)) return getLocalMediaUrl(id); const token = getToken(); const params = new URLSearchParams(); if (forceDownload) params.set('download', 'true'); if (token) params.set('access_token', token); const query = params.toString(); return apiUrl(`/resources/${id}/download${query ? `?${query}` : ''}`); }
export async function getResourceAccessUrl(id: string, forceDownload = false): Promise<string> { const response = await apiFetch(`/resources/${id}/access-url`); if (!response.ok) throw new Error('Failed to create resource access URL'); const body = await response.json(); return `${body.url}${forceDownload ? (body.url.includes('?') ? '&' : '?') + 'download=true' : ''}`; }
export async function getResourceText(id: string): Promise<string> { const response = await apiFetch(`/resource-editor/${id}/content`); if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to read resource content')); return response.text(); }
export async function saveResourceText(id: string, content: string): Promise<Resource> { const response = await apiFetch(`/resource-editor/${id}/content`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }); if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to save resource content')); return response.json(); }
export async function getDocxHtml(id: string): Promise<{ html: string; messages: Array<{ type?: string; message?: string }> }> { const response = await apiFetch(`/resource-editor/${id}/docx`); if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to open DOCX')); return response.json(); }
export async function saveDocxCopy(id: string, html: string): Promise<Resource> { const response = await apiFetch(`/resource-editor/${id}/docx-copy`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html }) }); if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to save DOCX copy')); return response.json(); }
export async function createPdfEditCopy(id: string): Promise<Resource> { const response = await apiFetch(`/resource-editor/${id}/pdf-copy`, { method: 'POST' }); if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to create PDF edit copy')); return response.json(); }
export async function replaceResourceFile(id: string, file: File): Promise<Resource> { const formData = new FormData(); formData.append('file', file); const response = await apiFetch(`/resource-editor/${id}/file`, { method: 'PUT', body: formData }); if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to replace resource file')); return response.json(); }

export async function uploadFile(file: File, parent: { item_id?: string; project_id?: string; note_id?: string; parent_resource_id?: string }, name?: string, onProgress?: (progress: number) => void, metadata?: { category?: string; description?: string; tags?: string[] }): Promise<Resource> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('File uploads require a connection to the central LabOS backend. Add a link instead, or reconnect and try again.');
  const formData = new FormData(); formData.append('file', file); if (name) formData.append('name', name); if (parent.item_id) formData.append('item_id', parent.item_id); if (parent.project_id) formData.append('project_id', parent.project_id); if (parent.note_id) formData.append('note_id', parent.note_id);
  if (metadata?.category) formData.append('category', metadata.category); if (metadata?.description) formData.append('description', metadata.description); if (metadata?.tags) formData.append('tags', JSON.stringify(metadata.tags));
  return new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.timeout = 120000; xhr.upload.addEventListener('progress', e => { if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100); }); xhr.addEventListener('load', () => { if (xhr.status === 201) resolve(JSON.parse(xhr.responseText)); else reject(new Error('Failed to upload file')); }); xhr.addEventListener('error', () => reject(new Error('Upload failed — could not reach the server. Is the backend running?'))); xhr.addEventListener('timeout', () => reject(new Error('Upload timed out after 2 minutes — check the backend server console for an error.'))); xhr.addEventListener('abort', () => reject(new Error('Upload was cancelled'))); xhr.open('POST', `${API_BASE}/resources`); const token = getToken(); if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`); xhr.send(formData); });
}
export async function createFolder(name: string, parent: { item_id?: string; project_id?: string; note_id?: string; parent_resource_id?: string }): Promise<Resource> {
  if (isTauriRuntime()) {
    return localInvoke<Resource>('create_local_resource_folder', { name, ...parent });
  }
  const response = await apiFetch('/resources/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ...parent }) });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to create folder'));
  return response.json();
}
export async function uploadFolderFiles(folderId: string, files: File[], relativePaths: string[], onProgress?: (progress: number) => void): Promise<Resource[]> { const formData = new FormData(); files.forEach(file => formData.append('files', file)); formData.append('relative_paths', JSON.stringify(relativePaths)); return new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.timeout = 120000; xhr.upload.addEventListener('progress', e => { if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100); }); xhr.addEventListener('load', () => { if (xhr.status === 201) resolve(JSON.parse(xhr.responseText)); else reject(new Error('Failed to upload folder files')); }); xhr.addEventListener('error', () => reject(new Error('Upload failed — could not reach the server. Is the backend running?'))); xhr.addEventListener('timeout', () => reject(new Error('Upload timed out after 2 minutes'))); xhr.addEventListener('abort', () => reject(new Error('Upload was cancelled'))); xhr.open('POST', `${API_BASE}/resources/${folderId}/files`); const token = getToken(); if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`); xhr.send(formData); }); }
export async function createLink(url: string, parent: { item_id?: string; project_id?: string; note_id?: string }, name?: string, metadata?: { category?: string; description?: string; tags?: string[] }): Promise<Resource> {
  if (isTauriRuntime()) {
    return localInvoke<Resource>('create_local_resource_link', { url, name, ...parent, ...metadata });
  }
  const response = await apiFetch('/resources/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, name, ...parent, ...metadata }) });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to create link'));
  return response.json();
}
export async function updateResourceMetadata(id: string, metadata: { category?: string; description?: string; tags?: string[] }): Promise<Resource> {
  if (isTauriRuntime()) {
    return localInvoke<Resource>('update_local_resource_metadata', { id, ...metadata });
  }
  const response = await apiFetch(`/resources/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metadata) });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to update resource metadata'));
  return response.json();
}
export async function deleteResource(id: string): Promise<void> {
  if (isTauriRuntime()) { await localInvoke('delete_local_resource', { id }); return; }
  const response = await apiFetch(`/resources/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to delete resource'));
}
