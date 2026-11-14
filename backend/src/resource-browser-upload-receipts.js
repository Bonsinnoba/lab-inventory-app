import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {requireResourceRead} from './middleware/resource-access.js';
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
const canonical=value=>typeof value==='string'?value.replaceAll('-','').toLowerCase():value??null;
export async function browserUploadRequest(req,inputs,folder,metadata){
 const key=req.get?.('Idempotency-Key')??req.headers?.['idempotency-key'];
 // Older explicitly-online clients remain compatible. Updated clients always
 // provide a persisted request identity before sending their first byte.
 if(key==null)return null;
 if(typeof key!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(key))fail(400,'INVALID_UPLOAD_REQUEST_ID','Upload request identity must be a UUID');
 const files=[];
 for(const file of inputs){let length=0;const hash=createHash('sha256');for await(const chunk of createReadStream(file.path,{highWaterMark:65536})){length+=chunk.length;hash.update(chunk);}if(length!==file.size)fail(409,'UPLOAD_SOURCE_CHANGED','Upload bytes changed before publication');files.push({name:file.originalname,mime:file.mimetype,size:length,sha256:hash.digest('hex')});}
 const body=req.body||{};
 let paths=null;if(folder){try{paths=JSON.parse(body.relative_paths||'[]');}catch{fail(400,'INVALID_FOLDER_PATHS','Folder paths must be a JSON array');}}
 return {key:key.toLowerCase(),payload:{protocol:1,folder,files,metadata,name:body.name??null,parents:folder?{parent_resource_id:canonical(req.params.folderId)}:Object.fromEntries(['item_id','project_id','note_id','parent_resource_id'].map(k=>[k,canonical(body[k]||null)])),paths,relative_path:body.relative_path??null}};
}
export async function readBrowserUploadReceipt(client,request,user){
 if(!request)return null;
 await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+request.key]);
 const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1 FOR UPDATE',[request.key])).rows[0];
 if(!prior)return null;
 if(prior.user_id!==user.userId||prior.device_id!=='browser-resource-upload'||prior.entity_type!=='resource_browser_upload'||prior.operation!=='upload_files')fail(409,'IDEMPOTENCY_OWNERSHIP_MISMATCH','Upload identity belongs to another request');
 if(!(await client.query('SELECT $1::jsonb=$2::jsonb AS same',[prior.payload_json,request.payload])).rows[0].same)fail(409,'IDEMPOTENCY_PAYLOAD_MISMATCH','This upload identity was already used with different files or details');
 const ids=prior.response_json?.resource_ids;if(!Array.isArray(ids)||!ids.length||ids.length>100)fail(409,'UPLOAD_RECEIPT_INVALID','Upload receipt requires recovery review');
 const rows=[];for(const id of ids){
  const row=(await client.query('SELECT * FROM resources WHERE id=$1 FOR SHARE',[id])).rows[0];
  if(!row)fail(409,'UPLOAD_ALREADY_RECORDED','This upload was already recorded and later removed; refresh Resources instead of recreating it');
  const access=await requireResourceRead(id,user);if(!access.ok)fail(access.status,access.error?.code||'RESOURCE_ACCESS_REQUIRED',access.error?.message||'Uploaded resource is no longer accessible');
  rows.push(row);
 }
 return rows;
}
export async function saveBrowserUploadReceipt(client,request,user,rows){
 if(!request)return;
 await client.query("INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,'browser-resource-upload',$2,'resource_browser_upload',$1,'upload_files',$3,$4,200)",[request.key,user.userId,request.payload,{resource_ids:rows.map(row=>row.id)}]);
}
