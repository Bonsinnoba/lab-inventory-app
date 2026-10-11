import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { resolveStoragePath } from './storage.js';
import { config } from './config.js';
import { binaryError } from './resource-binaries.js';

export const UPLOAD_CHUNK_BYTES = 1024 * 1024;
export function validateUploadRelativePath(value){
  if(typeof value!=='string'||!value||Buffer.byteLength(value,'utf8')>1024||/[\\\x00-\x1f\x7f:]/.test(value)||value.split('/').some(p=>!p||p==='.'||p==='..'))throw binaryError(400,'INVALID_UPLOAD_RELATIVE_PATH');
  return value;
}
const uuid = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw binaryError(400,'INVALID_UPLOAD_ID');
  return value.toLowerCase();
};
export function uploadDescriptor(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw binaryError(400,'INVALID_UPLOAD_DESCRIPTOR');
  const size = Number(value.size_bytes);
  if (!Number.isSafeInteger(size) || size < 0 || size > config.maxUploadMb * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(value.sha256 || '')) throw binaryError(400,'INVALID_UPLOAD_DESCRIPTOR');
  return { resource_id: uuid(value.resource_id), size_bytes: size, sha256: value.sha256 };
}
const directory = (user, change) => resolveStoragePath(`_offline_uploads/${uuid(user)}/${uuid(change)}`);
const digest = async filename => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
};
function assertDescriptor(row, d) {
  if (row.resource_id !== d.resource_id || Number(row.size_bytes) !== d.size_bytes || row.sha256 !== d.sha256) throw binaryError(409,'UPLOAD_IDENTITY_CONFLICT');
}

export async function uploadStagingStatus(client,userId,changeId,descriptor){
  const d=uploadDescriptor(descriptor);uuid(userId);uuid(changeId);
  const row=(await client.query('SELECT * FROM resource_upload_staging WHERE user_id=$1 AND change_id=$2',[userId,changeId])).rows[0];
  if(!row)return {next_offset:0,published:false,initialized:false};
  assertDescriptor(row,d);
  if(row.published)return {next_offset:d.size_bytes,published:true,initialized:true};
  for(let offset=0;offset<d.size_bytes;offset+=UPLOAD_CHUNK_BYTES){
    const size=await fs.stat(path.join(directory(userId,changeId),String(offset))).then(s=>s.size).catch(e=>{if(e.code==='ENOENT')return -1;throw e;});
    if(size!==Math.min(UPLOAD_CHUNK_BYTES,d.size_bytes-offset))return {next_offset:offset,published:false,initialized:true};
  }
  return {next_offset:d.size_bytes,published:false,initialized:true};
}

export async function stageUploadChunk(client,userId,changeId,descriptor,offset,bytes) {
  const d=uploadDescriptor(descriptor);uuid(userId);uuid(changeId);
  const length=Math.min(UPLOAD_CHUNK_BYTES,d.size_bytes-offset);
  if (!Number.isSafeInteger(offset)||offset<0||offset%UPLOAD_CHUNK_BYTES!==0||offset>d.size_bytes
      || !Buffer.isBuffer(bytes)||bytes.length!==length || (length===0 && d.size_bytes!==0)) throw binaryError(400,'INVALID_UPLOAD_CHUNK');
  await client.query('INSERT INTO resource_upload_staging(user_id,change_id,resource_id,size_bytes,sha256) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,change_id) DO NOTHING',[userId,changeId,d.resource_id,d.size_bytes,d.sha256]);
  const row=(await client.query('SELECT * FROM resource_upload_staging WHERE user_id=$1 AND change_id=$2 FOR UPDATE',[userId,changeId])).rows[0];
  assertDescriptor(row,d);
  if(row.published)return {received:true,published:true};
  const dir=directory(userId,changeId);await fs.mkdir(dir,{recursive:true});
  const target=path.join(dir,String(offset));
  const existing=await fs.readFile(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(existing){if(!existing.equals(bytes))throw binaryError(409,'UPLOAD_CHUNK_MISMATCH');return {received:true};}
  const temp=path.join(dir,`${offset}-${randomUUID()}.part`);
  try{
    const file=await fs.open(temp,'wx');try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    // The PostgreSQL row lock serializes writers, including multiple API processes.
    await fs.rename(temp,target);
  }finally{await fs.unlink(temp).catch(()=>{});}
  return {received:true};
}

// Called inside the same PostgreSQL transaction as resource creation + receipt.
// Physical publication is retryable; never remove it on an uncertain DB commit.
export async function prepareUploadedResource(client,change,user,record) {
  if(record.relative_path!=null){
    validateUploadRelativePath(record.relative_path);
    if(!record.parent_resource_id)throw binaryError(400,'UPLOAD_FOLDER_REQUIRED');
    const parent=uuid(record.parent_resource_id);
    // Serialize competing offline creates for the same logical folder path.
    // Byte storage remains ID-based; relative paths are never filesystem targets.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`resource-folder-path:${parent}:${record.relative_path.toLowerCase()}`]);
    const duplicate=await client.query('SELECT id FROM resources WHERE parent_resource_id=$1 AND lower(relative_path)=lower($2) AND id<>$3 LIMIT 1',[parent,record.relative_path,record.id]);
    if(duplicate.rowCount)throw binaryError(409,'UPLOAD_FOLDER_PATH_EXISTS');
  }
  const upload=change.payload?.upload;
  if(upload?.protocol!==1)throw binaryError(400,'UPLOAD_PROTOCOL_REQUIRED');
  const d=uploadDescriptor({...upload,resource_id:record.id});
  if(Number(record.size_bytes)!==d.size_bytes)throw binaryError(400,'UPLOAD_SIZE_MISMATCH');
  const row=(await client.query('SELECT * FROM resource_upload_staging WHERE user_id=$1 AND change_id=$2 FOR UPDATE',[user.userId,uuid(change.change_id)])).rows[0];
  if(!row)throw binaryError(503,'UPLOAD_BYTES_PENDING');
  assertDescriptor(row,d);
  const relative=`${d.resource_id}/offline-${uuid(change.change_id)}`;
  const target=resolveStoragePath(relative);
  if(await fs.stat(target).then(s=>s.isFile()&&s.size===d.size_bytes).catch(()=>false)){
    if(await digest(target)===d.sha256){await client.query('UPDATE resource_upload_staging SET published=TRUE WHERE user_id=$1 AND change_id=$2',[user.userId,change.change_id]);return relative;}
    throw binaryError(409,'PUBLISHED_UPLOAD_MISMATCH');
  }
  await fs.mkdir(path.dirname(target),{recursive:true});
  const temp=target+`.${randomUUID()}.part`;const hash=createHash('sha256');
  try{
    const output=await fs.open(temp,'wx');
    try{
      for(let offset=0;offset<d.size_bytes;offset+=UPLOAD_CHUNK_BYTES){
        const bytes=await fs.readFile(path.join(directory(user.userId,change.change_id),String(offset))).catch(error=>{if(error.code==='ENOENT')throw binaryError(503,'UPLOAD_BYTES_PENDING');throw error;});
        if(bytes.length!==Math.min(UPLOAD_CHUNK_BYTES,d.size_bytes-offset))throw binaryError(409,'UPLOAD_CHUNK_MISMATCH');
        hash.update(bytes);await output.writeFile(bytes);
      }
      if(hash.digest('hex')!==d.sha256)throw binaryError(409,'UPLOAD_CHECKSUM_MISMATCH');
      await output.sync();
    }finally{await output.close();}
    await fs.rename(temp,target);
    await client.query('UPDATE resource_upload_staging SET published=TRUE WHERE user_id=$1 AND change_id=$2',[user.userId,change.change_id]);
    return relative;
  }finally{await fs.unlink(temp).catch(()=>{});}
}
