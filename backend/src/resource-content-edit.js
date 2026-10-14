import fs from 'node:fs/promises';
import { requireResourceEditor } from './middleware/resource-access.js';
import { prepareUploadedResource } from './resource-upload-staging.js';
import { resolveStoragePath } from './storage.js';
import { writeAuditLog } from './middleware/audit.js';

function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
export function validateContentEdit(resource,record,edit){
  if(edit?.protocol!==1||record?.id!==resource.id||record.kind!=='file')fail(400,'INVALID_RESOURCE_EDIT','Invalid editor intent');
  const name=String(resource.original_filename||resource.name).toLowerCase();
  const format=edit.format??'markdown';
  if(!['markdown','pdf'].includes(format)||resource.kind!=='file')fail(400,'INVALID_RESOURCE_EDIT','Unsupported editor format');
  if(format==='markdown'&&(resource.file_type!=='text'||!(/\.(md|markdown)$/.test(name))))fail(400,'INVALID_RESOURCE_EDIT','Source is not Markdown');
  if(format==='pdf'&&(resource.file_type!=='pdf'||!name.endsWith('.pdf')))fail(400,'INVALID_RESOURCE_EDIT','Source is not PDF');
  if(!Number.isSafeInteger(record.size_bytes)||record.size_bytes<(format==='pdf'?5:0)||record.size_bytes>(format==='pdf'?500:4)*1024*1024)fail(413,'RESOURCE_EDIT_TOO_LARGE','Content is outside editor size limits');
  if(typeof edit.expected_updated_at!=='string'||!Number.isFinite(Date.parse(edit.expected_updated_at)))fail(400,'INVALID_RESOURCE_EDIT','Source revision required');
  if(edit.previous_change_id!=null&&(typeof edit.previous_change_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(edit.previous_change_id)))fail(400,'INVALID_RESOURCE_EDIT','Invalid predecessor identity');
  return format;
}
// Compatibility for existing pure Markdown validator callers.
export const validateMarkdownEdit=validateContentEdit;
export function validatePdfHeader(header){
  if(!Buffer.isBuffer(header)||!header.equals(Buffer.from('%PDF-')))fail(400,'RESOURCE_EDIT_ENCODING','Replacement must have a PDF header');
}
export function assertEditRevision(current,expected){
  if(new Date(current).getTime()!==new Date(expected).getTime())fail(409,'RESOURCE_EDIT_CONFLICT','Server content changed. Your saved local versions are preserved for review.');
}
export function predecessorRevision(prior,change,user,resourceId){
  if(!prior)fail(503,'RESOURCE_EDIT_DEPENDENCY_PENDING','An earlier saved version must synchronize first');
  if(prior.user_id!==user.userId||prior.device_id!==change.__device_id||prior.entity_type!=='resource'||prior.entity_id!==resourceId||!['edit_content','create','create_copy'].includes(prior.operation)||prior.response_json?.kind!=='file'||prior.response_json?.id!==resourceId)
    fail(409,'RESOURCE_EDIT_CONFLICT','Editor predecessor does not belong to this document and device');
  const revision=prior.response_json.updated_at;
  if(!revision||!Number.isFinite(Date.parse(revision)))fail(409,'RESOURCE_EDIT_CONFLICT','Earlier editor confirmation is incomplete');
  return revision;
}
export async function applyResourceContentEdit(client,change,user){
  const {resource:record,edit}=change.payload||{};
  if(record?.id!==change.entity_id)fail(400,'INVALID_RESOURCE_EDIT','Editor resource identity mismatch');
  const resource=(await client.query('SELECT * FROM resources WHERE id=$1 FOR UPDATE',[change.entity_id])).rows[0];
  if(!resource)fail(409,'RESOURCE_EDIT_CONFLICT','Resource no longer exists. Your saved local versions are preserved.');
  const access=await requireResourceEditor(resource.id,user);
  if(!access.ok)fail(access.status,access.error.code,access.error.message);
  const format=validateContentEdit(resource,record,edit);
  let expected=edit.expected_updated_at;
  if(edit.previous_change_id){
    const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1',[edit.previous_change_id])).rows[0];
    expected=predecessorRevision(prior,change,user,resource.id);
  }
  assertEditRevision(resource.updated_at,expected);
  // Publish a new immutable file path before the DB pointer swap. A failed or
  // uncertain commit never overwrites/removes the original or this staged file.
  const storagePath=await prepareUploadedResource(client,change,user,{...resource,size_bytes:record.size_bytes});
  const filename=resolveStoragePath(storagePath);
  if((await fs.stat(filename)).size!==record.size_bytes)fail(409,'RESOURCE_EDIT_BYTES_CHANGED','Saved editor bytes changed');
  if(format==='pdf'){
    const file=await fs.open(filename,'r');
    try{const header=Buffer.alloc(5);const {bytesRead}=await file.read(header,0,5,0);validatePdfHeader(header.subarray(0,bytesRead));}finally{await file.close();}
  }else{
    const bytes=await fs.readFile(filename);
    try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail(400,'RESOURCE_EDIT_ENCODING','Markdown must be valid UTF-8');}
  }
  const updated=(await client.query("UPDATE resources SET storage_path=$1,size_bytes=$2,updated_at=GREATEST(date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',updated_at)+interval '1 millisecond') WHERE id=$3 RETURNING *",[storagePath,record.size_bytes,resource.id])).rows[0];
  await writeAuditLog({req:{user},actorUserId:user.userId,action:'sync:edit_content',entityType:'resource',entityId:resource.id,client,required:true,deviceId:change.__device_id,oldValue:{size_bytes:resource.size_bytes},newValue:{size_bytes:record.size_bytes},metadata:{content_edited:true,format,source:'offline-editor'}});
  return updated;
}
