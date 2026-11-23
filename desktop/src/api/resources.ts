import {moveResourceTree,type TreeDestination} from './resource-tree-moves';
import { API_BASE } from '../lib/config';
import { apiFetch, apiUrl, getApiErrorMessage } from './http';
import { getToken, captureAccountSession, isAccountSessionCurrent, type AccountSession } from './auth';
import { invoke } from '@tauri-apps/api/tauri';
import { getDownloadJobs, getLocalMediaUrl } from './mediaDownloads';
import { isTauriRuntime } from '../lib/runtime';
import {pullResourcePosters} from './resource-posters';
import {buildFolderManifest} from '../lib/folderManifest';
import {writeResourceMetadataHttp} from './resource-metadata-http';
import {stageResourceFile,stageResourceFolderFiles,stagePdfReplacement,refreshLocalFileAccess,localFileUrl,localFilePending} from './resource-uploads';

export interface Resource {
  local_file_pending?: boolean;
  local_file_available?: boolean;
  local_copy?: {state:string;verified_bytes:number;size_bytes:number|null;error?:string|null};
  name_source?:'user'|'url_fallback'|'metadata'|null;
  id: string; name: string; kind: 'file' | 'folder' | 'link';
  file_type: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'document' | 'youtube' | 'other' | 'schematic_folder';
  original_filename?: string; mime_type?: string; size_bytes?: number; url?: string; thumbnail_url?: string;
  local_media_path?: string; local_media_filename?: string; local_media_mime_type?: string; local_media_size_bytes?: number; local_media_downloaded_at?: string;
  parent_resource_id?: string; relative_path?: string; item_id?: string; project_id?: string; note_id?: string;
  visibility?: 'lab' | 'project' | 'restricted';
  item_name?: string; project_name?: string; note_title?: string; category?: string; description?: string;
  tags?: string[]; updated_at?: string; created_at: string; derived_from_resource_id?: string;
}

export interface ResourceManifest { folder: string; files: Array<{ id: string; kind?:'file'|'folder'|'link'; relative_path: string; original_filename: string; size_bytes: number; mime_type: string; }>; }
export interface ResourceAccessGrant { user_id:string; username?:string; access_level:'view'|'edit'; created_at?:string; created_by?:string|null; }

type ResourceCopyStatuses=Record<string,NonNullable<Resource['local_copy']>>;
let copyStatusRead:{session:AccountSession;promise:Promise<ResourceCopyStatuses>}|null=null;
async function readDesktopCopyStatuses(session:AccountSession):Promise<ResourceCopyStatuses>{
  requireResourceReadSession(session);
  const running=copyStatusRead;
  if(running&&isAccountSessionCurrent(running.session)&&running.session.accountId===session.accountId&&
    running.session.token===session.token&&running.session.generation===session.generation)return running.promise;
  const flight={session,promise:Promise.resolve({} as ResourceCopyStatuses)};
  copyStatusRead=flight;
  flight.promise=(async()=>{try{
    const statuses=await localInvoke<ResourceCopyStatuses>('local_resource_copy_status',{expectedAccountId:session.accountId});
    requireResourceReadSession(session);
    return statuses;
  }finally{if(copyStatusRead===flight)copyStatusRead=null;}})();
  return flight.promise;
}

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


function requireResourceReadSession(session:AccountSession|null):void{
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading resources');
}
async function enrichWithDownloadedMedia(resources: Resource[],session:AccountSession|null): Promise<Resource[]> {
  requireResourceReadSession(session);
  try {
    const jobs = await getDownloadJobs();
    requireResourceReadSession(session);
    const completed = new Map(jobs.filter(job => job.status === 'completed' && job.local_media_filename).map(job => [job.resource_id, job]));
    localMediaResourceIds.clear();
    return resources.map(resource => {
      const job = completed.get(resource.id);
      if (!job) return resource;
      localMediaResourceIds.add(resource.id);
      return { ...resource, local_media_filename: job.local_media_filename, local_media_size_bytes: job.local_media_size_bytes, local_media_downloaded_at: job.completed_at || job.updated_at || new Date().toISOString() };
    });
  } catch {
    requireResourceReadSession(session);
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
  requireResourceReadSession(session);
  if (!response.ok) throw new Error('Failed to fetch resource');
  const resource = await response.json();
  requireResourceReadSession(session);
  await cacheLocalResources([resource], session);
  return (await enrichWithDownloadedMedia([resource],session))[0];
}
// Counts and relationships must not wait for capability/disk scans of every file.
// File availability is a separate proof, never inferred from this metadata read.
export async function getAllResourceMetadata():Promise<Resource[]>{
  return isTauriRuntime()?readDesktopResources({includeDescendants:true},false):getAllResources();
}
export async function getAllResources(): Promise<Resource[]> {
  if (isTauriRuntime()) {
    return readDesktopResources({includeDescendants:true});
  }
  const session = captureAccountSession();
  const response = await apiFetch('/resources?include_descendants=true');
  requireResourceReadSession(session);
  if (!response.ok) throw new Error('Failed to fetch resources');
  const resources = await response.json();
  requireResourceReadSession(session);
  await cacheLocalResources(resources, session);
  return enrichWithDownloadedMedia(resources,session);
}
export async function getResources(filters: { item_id?: string; project_id?: string; note_id?: string; parent_resource_id?: string }): Promise<Resource[]> {
  if (isTauriRuntime()) {
    return readDesktopResources({itemId:filters.item_id??null,projectId:filters.project_id??null,noteId:filters.note_id??null,parentResourceId:filters.parent_resource_id??null});
  }
  const params = new URLSearchParams(); if (filters.item_id) params.append('item_id', filters.item_id); if (filters.project_id) params.append('project_id', filters.project_id); if (filters.note_id) params.append('note_id', filters.note_id); if (filters.parent_resource_id) params.append('parent_resource_id', filters.parent_resource_id);
  const session = captureAccountSession();
  const response = await apiFetch(`/resources?${params}`); if (!response.ok) throw new Error('Failed to fetch resources');
  requireResourceReadSession(session);
  const resources = await response.json(); requireResourceReadSession(session); await cacheLocalResources(resources, session); return enrichWithDownloadedMedia(resources,session);
}
export async function getResourceManifest(id: string): Promise<ResourceManifest> {
  if(isTauriRuntime()){
    const session=captureAccountSession();
    if(!session)throw new Error('Sign in to read folder contents');
    const folder=await localInvoke<Resource>('get_local_resource',{id});
    if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading folder contents');
    if(!folder||folder.kind!=='folder')throw new Error('Resource is not a folder');
    // Listing names/relationships does not need to reauthorize every file's
    // bytes or scan every copy. The selected file is authorized when opened.
    const children=await localInvoke<Resource[]>('list_local_resources',{includeDescendants:true});
    if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading folder contents');
    if(!Array.isArray(children))throw Error('Local folder metadata is unavailable');
    return buildFolderManifest(folder,children);
  }
  const session=captureAccountSession();if(!session)throw Error('Sign in to read folder contents');
  const response=await apiFetch(`/resources/${encodeURIComponent(id)}/manifest`);if(!isAccountSessionCurrent(session))throw Error('Account changed while reading folder contents');if(!response.ok)throw new Error('Failed to fetch resource manifest');const result=await response.json();if(!isAccountSessionCurrent(session))throw Error('Account changed while reading folder contents');return result;
}
export function getResourceDownloadUrl(id: string, forceDownload = false): string { if(isTauriRuntime())return localFileUrl(id)||''; if (!forceDownload && localMediaResourceIds.has(id)) return getLocalMediaUrl(id); const token = getToken(); const params = new URLSearchParams(); if (forceDownload) params.set('download', 'true'); if (token) params.set('access_token', token); const query = params.toString(); return apiUrl(`/resources/${id}/download${query ? `?${query}` : ''}`); }
export async function exportResourceToDevice(id:string):Promise<boolean>{
 if(!isTauriRuntime())throw new Error('Native file export requires the desktop app');
 const result=await localEditorCommand<boolean>('export_local_resource_file',id);
 if(typeof result!=='boolean')throw new Error('Local file export was not confirmed; no server fallback');
 return result;
}
export async function getResourcePreviewText(id:string):Promise<string>{
 const session=captureAccountSession();if(!session)throw new Error('Sign in to preview resource text');
 const url=getResourceDownloadUrl(id);if(!url)throw new Error('A verified file copy is not available on this PC yet');
 const response=await fetch(url,{cache:'no-store',redirect:isTauriRuntime()?'error':'follow'});
 if(!isAccountSessionCurrent(session))throw new Error('Account changed while loading resource text');
 if(!response.ok)throw new Error(response.status===413?'This file is too large for a text preview. Export it to your device to open it.':`Unable to load resource (${response.status})`);
 const text=await response.text();if(!isAccountSessionCurrent(session))throw new Error('Account changed while loading resource text');return text;
}
export async function getResourceAccessUrl(id: string, forceDownload = false): Promise<string> { if(isTauriRuntime()){const local=localFileUrl(id);if(!local)throw new Error('A verified file copy is not available on this PC yet');return local;} const response = await apiFetch(`/resources/${id}/access-url`); if (!response.ok) throw new Error('Failed to create resource access URL'); const body = await response.json(); return `${body.url}${forceDownload ? (body.url.includes('?') ? '&' : '?') + 'download=true' : ''}`; }
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

// Browser transport journal only: stable request identities, never file bytes or
// credentials. Native authoring returns before this helper can be called.
function browserUploadIdentity(session:AccountSession,kind:string,files:File[],fields:unknown){
 const slot='labos.resource-upload.requests.v1';
 const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 const signature=JSON.stringify([API_BASE,session.accountId,kind,files.map(file=>({name:file.name,size:file.size,type:file.type,lastModified:file.lastModified??0})),canonical(fields)]);
 const read=():Record<string,string>=>{const text=sessionStorage.getItem(slot);if(!text)return{};let rows;try{rows=JSON.parse(text);}catch{throw Error('Upload retry storage is invalid; preserve it and resolve it before retrying');}if(!rows||typeof rows!=='object'||Array.isArray(rows)||Object.values(rows).some(value=>typeof value!=='string'||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(value)))throw Error('Upload retry storage is invalid; preserve it and resolve it before retrying');return rows;};
 const rows=read();let key=rows[signature];
 if(!key){if(Object.keys(rows).length>=100)throw Error('Resolve earlier upload requests before adding more');key=crypto.randomUUID();rows[signature]=key;sessionStorage.setItem(slot,JSON.stringify(rows));if(read()[signature]!==key)throw Error('Unable to persist upload retry identity');}
 return{key,complete:()=>{if(!isAccountSessionCurrent(session))throw Error('Account changed while confirming upload');const latest=read();if(latest[signature]===key){delete latest[signature];sessionStorage.setItem(slot,JSON.stringify(latest));}}};
}
export async function uploadFile(file: File, parent: { item_id?: string; project_id?: string; note_id?: string; parent_resource_id?: string }, name?: string, onProgress?: (progress: number) => void, metadata?: { category?: string; description?: string; tags?: string[] }): Promise<Resource> {
  if(isTauriRuntime())return stageResourceFile(file,{...parent,name,...metadata},onProgress);
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('File uploads require a connection to the central LabOS backend. Add a link instead, or reconnect and try again.');
  const formData = new FormData(); formData.append('file', file); if (name) formData.append('name', name); if (parent.item_id) formData.append('item_id', parent.item_id); if (parent.project_id) formData.append('project_id', parent.project_id); if (parent.note_id) formData.append('note_id', parent.note_id); if(parent.parent_resource_id)formData.append('parent_resource_id',parent.parent_resource_id);
  if (metadata?.category) formData.append('category', metadata.category); if (metadata?.description) formData.append('description', metadata.description); if (metadata?.tags) formData.append('tags', JSON.stringify(metadata.tags));
  const session=onlineResourceSession(),identity=browserUploadIdentity(session,'file',[file],{parent,name:name??null,metadata:metadata??null});
  return new Promise((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.timeout = 120000; xhr.upload.addEventListener('progress', e => { if (isAccountSessionCurrent(session) && e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100); }); xhr.addEventListener('load', async () => { if(!isAccountSessionCurrent(session))return reject(new Error('Account changed while uploading resources')); if (xhr.status === 201) { try { const resource = JSON.parse(xhr.responseText) as Resource; if(!resource?.id||resource.kind!=='file')throw Error('Incomplete upload confirmation; retry with the same file'); await cacheLocalResources([resource],session); if(!isAccountSessionCurrent(session))throw Error('Account changed while confirming upload'); identity.complete(); resolve(resource); } catch (e) { reject(e instanceof Error ? e : new Error('Failed to cache uploaded resource')); } } else reject(new Error('Upload was not confirmed. Refresh Resources before retrying.')); }); xhr.addEventListener('error', () => reject(new Error('Upload confirmation unavailable. Refresh Resources before retrying.'))); xhr.addEventListener('timeout', () => reject(new Error('Upload timed out; refresh Resources before retrying.'))); xhr.addEventListener('abort', () => reject(new Error('Upload was cancelled'))); xhr.open('POST', `${API_BASE}/resources`); xhr.setRequestHeader('Authorization', `Bearer ${session.token}`); xhr.setRequestHeader('Idempotency-Key',identity.key); xhr.send(formData); });
}
async function localResourceAuthor<T>(command:string,args:Record<string,unknown>):Promise<T>{
 const session=captureAccountSession();if(!session)throw Error('Sign in before changing resources');
 const status=await localInvoke<{resource_authoring_protocol?:number}>('local_database_status');
 if(!isAccountSessionCurrent(session))throw Error('Account changed before changing resources');
 if(status.resource_authoring_protocol!==1)throw Error('Resource authoring requires the updated desktop build');
 const expectedSessionToken=await localInvoke<string>('local_authorization_guard',{expectedAccountId:session.accountId});
 if(!isAccountSessionCurrent(session))throw Error('Account changed before resource write');
 const result=await localInvoke<T>(command,{...args,expectedAccountId:session.accountId,expectedSessionToken});
 if(!isAccountSessionCurrent(session))throw Error('Account changed during resource write');return result;
}
function onlineResourceSession():AccountSession{
 const session=captureAccountSession();if(!session||!session.token||session.token.startsWith('local:'))throw Error('Sign in online before changing server resources');return session;
}
async function resourceWriteResponse<T>(response:Response,session:AccountSession,message:string):Promise<T>{
 if(!isAccountSessionCurrent(session))throw Error('Account changed while saving resources');
 if(!response.ok){const error=await getApiErrorMessage(response,message);if(!isAccountSessionCurrent(session))throw Error('Account changed while reading resource confirmation');throw Error(error);}
 const result=await response.json();if(!isAccountSessionCurrent(session))throw Error('Account changed while reading resource confirmation');return result;
}
export async function createFolder(name: string, parent: { item_id?: string; project_id?: string; note_id?: string; parent_resource_id?: string },relativePath?:string): Promise<Resource> {
  if (isTauriRuntime()) {
    const owner=captureAccountSession();if(!owner)throw Error('Sign in before creating folders');
    if(relativePath!==undefined){const status=await localInvoke<{resource_folder_path_protocol?:number}>('local_database_status');if(!isAccountSessionCurrent(owner))throw Error('Account changed before creating a subfolder');if(status.resource_folder_path_protocol!==1)throw Error('Empty subfolders require the updated desktop build');}
    return localResourceAuthor<Resource>('create_local_resource_folder', { name, itemId:parent.item_id??null,projectId:parent.project_id??null,noteId:parent.note_id??null,parentResourceId:parent.parent_resource_id??null,...(relativePath!==undefined?{relativePath}:{}) });
  }
  if(relativePath!==undefined)throw Error('Empty subfolder authoring requires the desktop app');
  const session=onlineResourceSession();
  const response = await apiFetch('/resources/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ...parent }) });
  return resourceWriteResponse<Resource>(response,session,'Failed to create folder');
}
export async function uploadFolderFiles(folderId:string,files:File[],relativePaths:string[],onProgress?:(progress:number)=>void):Promise<Resource[]>{
 if(isTauriRuntime())return stageResourceFolderFiles(folderId,files,relativePaths,onProgress);
 const session=onlineResourceSession(),identity=browserUploadIdentity(session,'folder',files,{folderId,relativePaths}),formData=new FormData();files.forEach(file=>formData.append('files',file));formData.append('relative_paths',JSON.stringify(relativePaths));
 return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.timeout=120000;
  xhr.upload.addEventListener('progress',event=>{if(isAccountSessionCurrent(session)&&event.lengthComputable)onProgress?.(event.loaded/event.total*100);});
  xhr.addEventListener('load',()=>{
   if(!isAccountSessionCurrent(session))return reject(Error('Account changed while uploading files'));
   if(xhr.status!==201)return reject(Error('Folder upload was not confirmed. Refresh Resources before retrying.'));
   try{const result=JSON.parse(xhr.responseText);if(!Array.isArray(result)||result.length!==files.length||result.some(row=>!row?.id||row.kind!=='file')||new Set(result.map(row=>row.id)).size!==result.length)throw Error('Invalid folder upload response');identity.complete();resolve(result);}catch(error){reject(error);}
  });
  xhr.addEventListener('error',()=>reject(Error('Upload confirmation unavailable. Refresh Resources before retrying.')));
  xhr.addEventListener('timeout',()=>reject(Error('Upload timed out; refresh Resources before retrying.')));
  xhr.addEventListener('abort',()=>reject(Error('Upload was cancelled')));
  xhr.open('POST',`${API_BASE}/resources/${encodeURIComponent(folderId)}/files`);xhr.setRequestHeader('Authorization',`Bearer ${session.token}`);xhr.setRequestHeader('Idempotency-Key',identity.key);xhr.send(formData);
 });
}
export async function createLink(url: string, parent: { item_id?: string; project_id?: string; note_id?: string }, name?: string, metadata?: { category?: string; description?: string; tags?: string[] }): Promise<Resource> {
  if (isTauriRuntime()) {
    return localResourceAuthor<Resource>('create_local_resource_link', { url, name, itemId:parent.item_id??null, projectId:parent.project_id??null, noteId:parent.note_id??null, ...metadata });
  }
  const session=onlineResourceSession();
  const response = await apiFetch('/resources/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, name, ...parent, ...metadata }) });
  return resourceWriteResponse<Resource>(response,session,'Failed to create link');
}
export async function attachExistingResource(id: string, destination: TreeDestination): Promise<Resource> {
  const session=captureAccountSession();
  if(isTauriRuntime()){
    if(!session||!isAccountSessionCurrent(session))throw new Error('Sign in before moving resources');
    const expectedSessionToken=await localInvoke<string>('local_authorization_guard',{expectedAccountId:session.accountId});
    if(!isAccountSessionCurrent(session))throw new Error('Account changed while moving resource');
    const source=await localInvoke<Resource>('get_local_resource',{id});
    if(!isAccountSessionCurrent(session))throw new Error('Account changed while selecting move path');
    if(source.kind==='folder'||destination.parent_resource_id||source.parent_resource_id)return moveResourceTree(id,destination);
    const direct={item_id:destination.item_id??null,project_id:destination.project_id??null,note_id:destination.note_id??null};
    const resource=await localInvoke<Resource>('move_local_resource_attachment',{
      expectedAccountId:session.accountId,expectedSessionToken,resourceId:id,destination:direct,
    });
    if(!isAccountSessionCurrent(session))throw new Error('Account changed while moving resource');
    return resource;
  }
  if(destination.parent_resource_id)throw new Error('Whole-folder destinations require the updated desktop app');
  const response=await apiFetch(`/resources/${encodeURIComponent(id)}/attachment`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({item_id:destination.item_id??null,project_id:destination.project_id??null,note_id:destination.note_id??null})});
  if(!response.ok)throw new Error(await getApiErrorMessage(response,'Unable to attach resource'));
  const resource:Resource=await response.json();
  await cacheLocalResources([resource],session);
  return resource;
}
export type ReviewedResourceMetadata=Pick<Resource,'updated_at'|'category'|'description'|'tags'>&{name?:string};
export async function updateResourceMetadata(id: string, metadata: { name?:string;category?: string; description?: string; tags?: string[] }, reviewed?:ReviewedResourceMetadata, owner?:AccountSession|null): Promise<Resource> {
  if(owner&&!isAccountSessionCurrent(owner))throw new Error('Account changed; reopen resource details before saving');
  if (isTauriRuntime()) {
    const session=captureAccountSession();
    if(!session||!isAccountSessionCurrent(session))throw new Error('Sign in before editing resource metadata');
    const status=await localInvoke<{resource_mutation_protocol?:number;resource_metadata_review_protocol?:number;resource_metadata_name_protocol?:number}>('local_database_status');
    if(status?.resource_mutation_protocol!==1)throw new Error('Resource metadata editing requires an updated desktop build');
    if(reviewed&&status?.resource_metadata_review_protocol!==1)throw new Error('Reviewed resource details require an updated desktop build');
    if((metadata.name!==undefined||reviewed?.name!==undefined)&&status?.resource_metadata_name_protocol!==1)throw new Error('Resource naming requires the updated desktop build');
    const expectedSessionToken=await localInvoke<string>('local_authorization_guard',{expectedAccountId:session.accountId});
    if(!isAccountSessionCurrent(session))throw new Error('Account changed while editing resource metadata');
    const resource=await localInvoke<Resource>('update_local_resource_metadata', { id, ...metadata,...(reviewed?{reviewedMetadata:reviewed}:{}),expectedAccountId:session.accountId,expectedSessionToken });
    if(!isAccountSessionCurrent(session))throw new Error('Account changed while editing resource metadata');
    return resource;
  }
  return writeResourceMetadataHttp(id,metadata,reviewed?.updated_at||'');
}
async function readDesktopResources(filters?:Record<string,unknown>,withFiles=true):Promise<Resource[]>{
  const session=captureAccountSession();
  if(!isAccountSessionCurrent(session))throw new Error('Sign in to read resources');
  const rows=await localInvoke<Resource[]>('list_local_resources',filters);
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading resources');
  if(!Array.isArray(rows))throw new Error('Local resource list is unavailable');
  rememberDesktopMedia(rows,session.accountId,!filters||filters.includeDescendants===true);
  if(!withFiles)return rows;
  // File capability failure must not hide otherwise available SQLite metadata.
  const [,copies]=await Promise.all([
    refreshLocalFileAccess({reuseInFlight:true}).catch(()=>undefined),
    readDesktopCopyStatuses(session).catch(()=>({} as ResourceCopyStatuses)),
  ]);
  if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading resources');
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
  if (isTauriRuntime()) { await localResourceAuthor('delete_local_resource', { id }); return; }
  const response = await apiFetch(`/resources/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await getApiErrorMessage(response, 'Failed to delete resource'));
}
