import fs from 'node:fs/promises';
import path from 'node:path';
import {pool} from './db.js';
import {getUserPermissions} from './middleware/permissions.js';
import {requireLockedResourceEditor,requireLockedResourceDestination} from './resource-scope-lock.js';
import {writeAuditLog} from './middleware/audit.js';
import {currentResourceActor} from './resource-sync-actor.js';
import {requireResourceNamespace} from './resource-folder-namespace.js';
import {inferFileType,resolveStoragePath,sanitizeRelativePath} from './storage.js';
import {prepareResourcePoster} from './resource-posters.js';
import {browserUploadRequest,readBrowserUploadReceipt,saveBrowserUploadReceipt} from './resource-browser-upload-receipts.js';
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};

// Browser-only multipart transport. Desktop authors still use native staged
// files and the outbox. File publication never gets undone after an uncertain
// COMMIT; a lost response must not delete an already committed user's file.
export function browserResourceUpload({folder=false,metadata}){
 return async function upload(req,res){
  const inputs=folder?(req.files||[]):req.file?[req.file]:[];
  let client,commitAttempted=false,created=[];const published=[];
  try{
   if(!inputs.length)fail(400,'UPLOAD_FILES_REQUIRED','Choose at least one file');
   const knowledge=metadata(req.body),request=await browserUploadRequest(req,inputs,folder,knowledge);
   client=await pool.connect();await client.query('BEGIN');
   const user=await currentResourceActor(client,req.user);
   const permissions=await getUserPermissions(user.userId,user.role,{client,lock:true});
   if(!permissions.has('resources.view')||!permissions.has('resources.create'))fail(403,'PERMISSION_DENIED','Resource view and create permissions required');
   let parents,paths=[];
   if(folder){
    const parent=(await client.query("SELECT id FROM resources WHERE id=$1 AND kind='folder' FOR SHARE",[req.params.folderId])).rows[0];
    if(!parent)fail(404,'RESOURCE_FOLDER_NOT_FOUND','Folder resource not found');
    const access=await requireLockedResourceEditor(client,parent.id,user);if(!access.ok)fail(access.status,access.error.code,access.error.message);
    if(access.context.resources.length>=32)fail(409,'RESOURCE_DEPTH_EXCEEDED','This folder has reached the supported nesting depth');
    parents={item_id:null,project_id:null,note_id:null,parent_resource_id:parent.id};
    try{paths=JSON.parse(req.body.relative_paths||'[]');}catch{fail(400,'INVALID_FOLDER_PATHS','Folder paths must be a JSON array');}
    if(!Array.isArray(paths)||paths.some(value=>typeof value!=='string')||paths.length&&paths.length!==inputs.length)fail(400,'INVALID_FOLDER_PATHS','Folder files and paths must match');
   }else{
    parents=Object.fromEntries(['item_id','project_id','note_id','parent_resource_id'].map(key=>[key,req.body[key]||null]));
    if(Object.values(parents).filter(Boolean).length>1)fail(400,'INVALID_RESOURCE_PARENT','Choose one resource attachment');
    const access=await requireLockedResourceDestination(client,parents,user);
    if(!access.ok)fail(access.status,access.error?.code||'RESOURCE_PARENT_DENIED',access.error?.message||'Resource destination unavailable');
    if(req.body.relative_path!=null&&!parents.parent_resource_id)fail(400,'INVALID_FOLDER_PATH','A folder path needs a parent folder');
   }
   const replay=await readBrowserUploadReceipt(client,request,user);
   if(replay)created=replay;
   else for(const [index,file] of inputs.entries()){
    const relative=folder?sanitizeRelativePath(paths[index]||file.originalname):parents.parent_resource_id?sanitizeRelativePath(req.body.relative_path||file.originalname):null;
    const name=folder?path.posix.basename(relative):req.body.name||file.originalname;
    if(relative)await requireResourceNamespace(client,{...parents,kind:'file',name,original_filename:file.originalname,relative_path:relative});
    const resource=(await client.query("INSERT INTO resources(name,kind,file_type,original_filename,mime_type,size_bytes,item_id,project_id,note_id,parent_resource_id,relative_path,category,description,tags,uploaded_by) VALUES($1,'file',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *",[name,inferFileType(file.mimetype,file.originalname),file.originalname,file.mimetype,file.size,parents.item_id,parents.project_id,parents.note_id,parents.parent_resource_id,relative,knowledge.category,knowledge.description,knowledge.tags,user.userId])).rows[0];
    const filename=sanitizeRelativePath(path.basename(file.originalname));
    if(filename.includes('/'))fail(400,'INVALID_UPLOAD_FILENAME','Use a file name without directory separators');
    const storage=`${resource.id}/${filename}`,target=resolveStoragePath(storage);
    await fs.mkdir(path.dirname(target),{recursive:true});await fs.rename(file.path,target);published.push(target);
    const updated=(await client.query('UPDATE resources SET storage_path=$1 WHERE id=$2 RETURNING *',[storage,resource.id])).rows[0];
    await writeAuditLog({req,action:'CREATE',entityType:'resource',entityId:updated.id,newValue:updated,client,required:true});created.push(updated);
   }
   if(!replay)await saveBrowserUploadReceipt(client,request,user,created);
   commitAttempted=true;await client.query('COMMIT');
  }catch(error){
   if(client)await client.query('ROLLBACK').catch(()=>{});
   // Before COMMIT was attempted, only this request's new, unpublished files
   // can be removed. Preserve bytes when the database outcome is uncertain.
   if(!commitAttempted)for(const target of published)await fs.unlink(target).catch(()=>{});
   return res.status(commitAttempted?503:error.status||500).json({error:{code:commitAttempted?'UPLOAD_CONFIRMATION_UNCERTAIN':error.code||'UPLOAD_FAILED',message:commitAttempted?'Upload confirmation was lost. Refresh Resources before retrying; any committed files have been preserved.':error.message||'Upload failed'}});
  }finally{
   client?.release();for(const file of inputs)await fs.unlink(file.path).catch(()=>{});
  }
  for(const resource of created)void Promise.resolve().then(()=>prepareResourcePoster(resource)).catch(()=>{});
  return res.status(201).json(folder?created:created[0]);
 };
}
