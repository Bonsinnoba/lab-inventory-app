import { API_BASE } from '../lib/config';
import { apiFetch, apiUrl, getApiErrorMessage } from './http';
import { getToken } from './auth';

export interface Resource {
  id: string;
  name: string;
  kind: 'file' | 'folder' | 'link';
  file_type: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'document' | 'youtube' | 'other' | 'schematic_folder';
  original_filename?: string;
  mime_type?: string;
  size_bytes?: number;
  url?: string;
  thumbnail_url?: string;
  parent_resource_id?: string;
  relative_path?: string;
  item_id?: string;
  project_id?: string;
  note_id?: string;
  // Only present when fetched via getAllResources() (the standalone
  // Resources page) — shows what each resource is attached to.
  item_name?: string;
  project_name?: string;
  note_title?: string;
  category?: string;
  description?: string;
  tags?: string[];
  updated_at?: string;
  created_at: string;
}

export interface ResourceManifest {
  folder: string;
  files: Array<{
    id: string;
    relative_path: string;
    original_filename: string;
    size_bytes: number;
    mime_type: string;
  }>;
}

export async function getResource(id: string): Promise<Resource> {
  const response = await apiFetch(`/resources/${id}`);
  if (!response.ok) throw new Error('Failed to fetch resource');
  return response.json();
}

// Every top-level resource in the lab, regardless of what it's attached
// to — powers the standalone Resources page (as opposed to getResources,
// which scopes to one item/project/note).
export async function getAllResources(): Promise<Resource[]> {
  const response = await apiFetch(`/resources`);
  if (!response.ok) throw new Error('Failed to fetch resources');
  return response.json();
}

export async function getResources(filters: {
  item_id?: string;
  project_id?: string;
  note_id?: string;
  parent_resource_id?: string;
}): Promise<Resource[]> {
  const params = new URLSearchParams();
  if (filters.item_id) params.append('item_id', filters.item_id);
  if (filters.project_id) params.append('project_id', filters.project_id);
  if (filters.note_id) params.append('note_id', filters.note_id);
  if (filters.parent_resource_id) params.append('parent_resource_id', filters.parent_resource_id);
  
  const response = await apiFetch(`/resources?${params}`);
  if (!response.ok) throw new Error('Failed to fetch resources');
  return response.json();
}

export async function getResourceManifest(id: string): Promise<ResourceManifest> {
  const response = await apiFetch(`/resources/${id}/manifest`);
  if (!response.ok) throw new Error('Failed to fetch resource manifest');
  return response.json();
}

export function getResourceDownloadUrl(id: string, forceDownload = false): string {
  const token = getToken();
  const params = new URLSearchParams();
  if (forceDownload) params.set('download', 'true');
  if (token) params.set('access_token', token);
  const query = params.toString();
  return apiUrl(`/resources/${id}/download${query ? `?${query}` : ''}`);
}

// Media/PDF elements cannot attach a bearer header themselves. The backend
// therefore exposes a short-lived, resource-scoped access token for these
// display URLs. It is intentionally short-lived and only grants one resource.
export async function getResourceAccessUrl(id: string, forceDownload = false): Promise<string> {
  const response = await apiFetch(`/resources/${id}/access-url`);
  if (!response.ok) throw new Error('Failed to create resource access URL');
  const body = await response.json();
  return `${body.url}${forceDownload ? (body.url.includes('?') ? '&' : '?') + 'download=true' : ''}`;
}

export async function uploadFile(
  file: File,
  parent: { item_id?: string; project_id?: string; note_id?: string },
  name?: string,
  onProgress?: (progress: number) => void,
  metadata?: { category?: string; description?: string; tags?: string[] }
): Promise<Resource> {
  const formData = new FormData();
  formData.append('file', file);
  if (name) formData.append('name', name);
  if (parent.item_id) formData.append('item_id', parent.item_id);
  if (parent.project_id) formData.append('project_id', parent.project_id);
  if (parent.note_id) formData.append('note_id', parent.note_id);
  if (metadata?.category) formData.append('category', metadata.category);
  if (metadata?.description) formData.append('description', metadata.description);
  if (metadata?.tags) formData.append('tags', JSON.stringify(metadata.tags));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Without an explicit timeout, if the connection is accepted but the
    // server never actually responds (crashed mid-request, hung on a
    // promise that never settles, etc.), this promise would never
    // resolve OR reject — leaving the UI stuck on "Uploading…" forever
    // with no way to recover. 2 minutes is generous for a large video
    // file on a local network; genuinely stalled requests should not
    // take anywhere near that long to at least get a response.
    xhr.timeout = 120000;

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress((e.loaded / e.total) * 100);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 201) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let message = 'Failed to upload file';
        try {
          const body = JSON.parse(xhr.responseText);
          const error = body?.error;
          if (typeof error === 'string') message = error;
          else if (error && typeof error.message === 'string') message = error.message;
          else if (typeof body?.message === 'string') message = body.message;
        } catch {
          // response wasn't JSON — keep the generic message
        }
        reject(new Error(message));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Upload failed — could not reach the server. Is the backend running?'));
    });

    xhr.addEventListener('timeout', () => {
      reject(new Error('Upload timed out after 2 minutes — the server accepted the connection but never responded. Check the backend server\'s console for an error.'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload was cancelled'));
    });

    xhr.open('POST', `${API_BASE}/resources`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  });
}

export async function createFolder(
  name: string,
  parent: { item_id?: string; project_id?: string; note_id?: string }
): Promise<Resource> {
  const response = await apiFetch(`/resources/folder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...parent }),
  });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to create folder'));
  return response.json();
}

export async function uploadFolderFiles(
  folderId: string,
  files: File[],
  relativePaths: string[],
  onProgress?: (progress: number) => void
): Promise<Resource[]> {
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));
  formData.append('relative_paths', JSON.stringify(relativePaths));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.timeout = 120000;

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress((e.loaded / e.total) * 100);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 201) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        let message = 'Failed to upload folder files';
        try {
          const body = JSON.parse(xhr.responseText);
          const error = body?.error;
          if (typeof error === 'string') message = error;
          else if (error && typeof error.message === 'string') message = error.message;
          else if (typeof body?.message === 'string') message = body.message;
        } catch {
          // response wasn't JSON — keep the generic message
        }
        reject(new Error(message));
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error('Upload failed — could not reach the server. Is the backend running?'));
    });

    xhr.addEventListener('timeout', () => {
      reject(new Error('Upload timed out after 2 minutes — the server accepted the connection but never responded. Check the backend server\'s console for an error.'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload was cancelled'));
    });

    xhr.open('POST', `${API_BASE}/resources/${folderId}/files`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  });
}

export async function createLink(
  url: string,
  parent: { item_id?: string; project_id?: string; note_id?: string },
  name?: string,
  metadata?: { category?: string; description?: string; tags?: string[] }
): Promise<Resource> {
  const response = await apiFetch(`/resources/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, name, ...parent, ...metadata }),
  });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to create link'));
  return response.json();
}

export async function updateResourceMetadata(id: string, metadata: { category?: string; description?: string; tags?: string[] }): Promise<Resource> {
  const response = await apiFetch(`/resources/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to update resource metadata'));
  return response.json();
}

export async function deleteResource(id: string): Promise<void> {
  const response = await apiFetch(`/resources/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to delete resource'));
}
