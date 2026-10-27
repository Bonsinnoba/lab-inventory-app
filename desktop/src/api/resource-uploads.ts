import { localBackend } from './local-backend';
import { captureAccountSession, isAccountSessionCurrent } from './auth';
import { apiFetch, getApiErrorMessage } from './http';
import type { Resource } from './resources';
import { convertFileSrc } from '@tauri-apps/api/tauri';

const CHUNK=1024*1024;
let fileAccess:{session:ReturnType<typeof captureAccountSession>;files:Record<string,{path:string;pending:boolean}>}|null=null;
let fileAccessRequest=0;
export async function refreshLocalFileAccess():Promise<void>{
  const request=++fileAccessRequest;
  const session=captureAccountSession();if(!session){fileAccess=null;return;}
  // Keep the current session's capabilities visible during the read. The native
  // protocol still checks authorization on every request; failure clears access.
  try{
    const files=await localBackend.invoke<Record<string,{path:string;pending:boolean}>>('local_resource_file_access',{expectedAccountId:session.accountId});
    if(!isAccountSessionCurrent(session))throw new Error('Account changed while reading local file access');
    if(request===fileAccessRequest)fileAccess={session,files};
  }catch(error){if(request===fileAccessRequest)fileAccess=null;throw error;}
}
export function localFileUrl(id:string):string|null{
  if(!fileAccess||!isAccountSessionCurrent(fileAccess.session))return null;
  const entry=fileAccess.files[id];return entry?convertFileSrc(entry.path,'labos-file'):null;
}
export function localFilePending(id:string):boolean{return !!fileAccess&&isAccountSessionCurrent(fileAccess.session)&&!!fileAccess.files[id]?.pending;}
export async function stageResourceFile(file:File,metadata:Record<string,unknown>,onProgress?:(n:number)=>void):Promise<Resource>{
  return (await stageFiles([{file,metadata}],false,onProgress))[0];
}

export async function stagePdfReplacement(resourceId:string,file:File,expectedRevision:string,onProgress?:(n:number)=>void):Promise<Resource>{
  if(!expectedRevision)throw new Error('Reopen the editor to verify the PDF revision');
  if(!file.name.toLowerCase().endsWith('.pdf')||file.size<5||file.size>500*1024*1024)throw new Error('Choose a PDF file no larger than 500 MiB');
  const session=captureAccountSession();if(!session)throw new Error('Sign in before replacing files');
  const assertCurrent=()=>{if(!isAccountSessionCurrent(session))throw new Error('Account changed while saving replacement');};
  const expectedSessionToken=await localBackend.invoke<string>('local_authorization_guard',{expectedAccountId:session.accountId});assertCurrent();
  const guard={expectedAccountId:session.accountId,expectedSessionToken};
  const staged=await localBackend.invoke<{change_id:string}>('begin_local_pdf_replacement',{...guard,resourceId,expectedRevision,sizeBytes:file.size});assertCurrent();
  for(let offset=0;offset<file.size;offset+=CHUNK){
    const bytes=new Uint8Array(await file.slice(offset,offset+CHUNK).arrayBuffer());assertCurrent();
    await localBackend.invoke('write_local_pdf_replacement_chunk',{...guard,changeId:staged.change_id,offset,bytes:Array.from(bytes)});assertCurrent();
    onProgress?.(Math.floor(Math.min(file.size,offset+bytes.length)/file.size*95));
  }
  const result=await localBackend.invoke<Resource>('finish_local_pdf_replacement',{...guard,changeId:staged.change_id});assertCurrent();
  await refreshLocalFileAccess().catch(()=>undefined);assertCurrent();onProgress?.(100);return result;
}

export function validateFolderPaths(files:File[],paths:string[]):string[]{
  if(!files.length||files.length>200||files.length!==paths.length)throw new Error('Select between 1 and 200 files with matching relative paths');
  const seen=new Set<string>();
  return paths.map(path=>{
    const normalized=path.replace(/\\/g,'/');
    if(!normalized||normalized.length>1024||/[\x00-\x1f\x7f:]/.test(normalized)||normalized.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('Invalid folder file path');
    const key=normalized.toLowerCase();
    if(seen.has(key))throw new Error(`Duplicate folder file path: ${normalized}`);
    seen.add(key);return normalized;
  });
}

export async function stageResourceFolderFiles(folderId:string,files:File[],paths:string[],onProgress?:(n:number)=>void):Promise<Resource[]>{
  const normalized=validateFolderPaths(files,paths);
  return stageFiles(files.map((file,i)=>({file,metadata:{parent_resource_id:folderId,relative_path:normalized[i],name:normalized[i].split('/').pop()}})),true,onProgress);
}

async function stageFiles(entries:Array<{file:File;metadata:Record<string,unknown>}>,batch:boolean,onProgress?:(n:number)=>void):Promise<Resource[]>{
  const session=captureAccountSession();
  if(!session)throw new Error('Sign in before saving files');
  const expectedSessionToken=await localBackend.invoke<string>('local_authorization_guard',{expectedAccountId:session.accountId});
  const assertCurrent=()=>{if(!isAccountSessionCurrent(session))throw new Error('Account changed while saving file');};
  assertCurrent();
  const guard={expectedAccountId:session.accountId,expectedSessionToken};
  const changeIds:string[]=[];
  for(const [index,{file,metadata}] of entries.entries()){
  const upload=await localBackend.invoke<{change_id:string}>('begin_local_resource_upload',{
    ...guard,metadata:{...metadata,original_filename:file.name,mime_type:file.type||'application/octet-stream',size_bytes:file.size},
  });
  changeIds.push(upload.change_id);
  assertCurrent();
  for(let offset=0;offset<file.size;offset+=CHUNK){
    const bytes=new Uint8Array(await file.slice(offset,offset+CHUNK).arrayBuffer());
    assertCurrent();
    await localBackend.invoke('write_local_resource_upload_chunk',{...guard,changeId:upload.change_id,offset,bytes:Array.from(bytes)});
    assertCurrent();onProgress?.(Math.floor((index+Math.min(file.size,offset+bytes.length)/file.size)/entries.length*95));
  }
  }
  assertCurrent();
  const resources=batch
    ?await localBackend.invoke<Resource[]>('finish_local_resource_upload_batch',{...guard,changeIds})
    :[await localBackend.invoke<Resource>('finish_local_resource_upload',{...guard,changeId:changeIds[0]})];
  assertCurrent();onProgress?.(100);return resources;
}

export type UploadChange={change_id:string;entity_type:string;entity_id?:string|null;operation:string;payload:unknown};
export function isResourceUpload(change:UploadChange):boolean{
  const p=change.payload as {upload?:{protocol?:number};resource?:{kind?:string}}|null;
  return change.entity_type==='resource'&&['create','create_copy','edit_content'].includes(change.operation)&&p?.resource?.kind==='file'&&p.upload?.protocol===1;
}
// Only the sync worker calls this. A failed transfer leaves the authored outbox
// record and managed PC file intact. Stable change ID + offsets make retry safe.
export async function transferResourceUpload(change:UploadChange,accountId:string,nativeSessionToken:string,assertCurrent:()=>void,onStep?:(step:string)=>void):Promise<void>{
  const payload=change.payload as {resource:{id:string};upload:{sha256:string;size_bytes:number}};
  const size=payload.upload.size_bytes;
  const base=change.operation==='edit_content'?'/resource-editor/uploads':'/resources/uploads';
  if(!Number.isSafeInteger(size)||size<0)throw new Error('Invalid saved upload size');
  assertCurrent();
  onStep?.('Checking upload status');
  const statusResponse=await apiFetch(`${base}/${encodeURIComponent(change.change_id)}/status`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload.upload,resource_id:payload.resource.id})});
  assertCurrent();if(!statusResponse.ok)throw new Error(await getApiErrorMessage(statusResponse,'File transfer status unavailable'));
  onStep?.('Reading upload status response');
  const status=await statusResponse.json() as {next_offset:number;published:boolean;initialized:boolean};assertCurrent();
  if(!Number.isSafeInteger(status.next_offset)||status.next_offset<0||status.next_offset>size||(status.next_offset!==size&&status.next_offset%CHUNK!==0))throw new Error('Invalid server upload offset');
  if(status.published||(status.initialized&&status.next_offset===size))return;
  for(let offset=status.next_offset;offset<size||offset===0;offset+=CHUNK){
    assertCurrent();
    onStep?.(`Reading local file at byte ${offset}`);
    const bytes=await localBackend.invoke<number[]>(change.operation==='edit_content'?'read_local_resource_edit_chunk':'read_local_resource_upload_chunk',{
      expectedAccountId:accountId,expectedSessionToken:nativeSessionToken,changeId:change.change_id,offset,
    });
    assertCurrent();
    if(bytes.length!==Math.min(CHUNK,size-offset))throw new Error('Saved file chunk is incomplete');
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),45000);
    try{
      onStep?.(`Uploading file at byte ${offset}`);
      const response=await apiFetch(`${base}/${encodeURIComponent(change.change_id)}/chunk`,{
        method:'POST',signal:controller.signal,headers:{'Content-Type':'application/octet-stream',
          'X-Resource-Id':payload.resource.id,'X-File-Size':String(size),'X-File-SHA256':payload.upload.sha256,'X-Chunk-Offset':String(offset)},
        body:new Uint8Array(bytes),
      });
      assertCurrent();if(!response.ok)throw new Error(await getApiErrorMessage(response,'File transfer pending'));
    }finally{clearTimeout(timeout);}
    if(size===0)break;
  }
}
