import {catalogUuid} from './catalog-sync.js';
import {requireProjectWorkAuthority} from './project-work-authority.js';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export function workAttachmentIdentity(record,entityId){
 if(!record||typeof record!=='object'||Array.isArray(record))fail(400,'INVALID_PROJECT_ATTACHMENT','Attachment record is required');
 const id=catalogUuid(entityId),projectId=catalogUuid(record.project_id);
 if(record.id!=null&&catalogUuid(record.id)!==id)fail(400,'INVALID_PROJECT_ATTACHMENT','Attachment identity changed');
 if(Boolean(record.task_id)===Boolean(record.experiment_id))fail(400,'INVALID_PROJECT_ATTACHMENT','Choose exactly one work parent');
 const parentField=record.task_id?'task_id':'experiment_id';
 return {id,projectId,parentField,parentId:catalogUuid(record[parentField]),resourceId:catalogUuid(record.resource_id)};
}
export function assertWorkResourceScope(resource,projectId){
 if(!resource||resource.project_id!==projectId||resource.item_id||resource.note_id||resource.parent_resource_id)fail(404,'PROJECT_RESOURCE_UNAVAILABLE','Choose an available resource attached directly to this project');
}
async function resourceForAttachment(client,identity,actor){
 if(!actor.permissions.has('resources.view'))fail(403,'RESOURCE_VIEW_REQUIRED','Resource view permission required');
 const resource=(await client.query('SELECT id,project_id,item_id,note_id,parent_resource_id,visibility FROM resources WHERE id=$1 FOR SHARE',[identity.resourceId])).rows[0];
 assertWorkResourceScope(resource,identity.projectId);
 // The project and membership/grant authority are already locked. Lock any
 // restricted resource grant too, so a concurrent revocation cannot race ACK.
 const grant=(await client.query("SELECT access_level FROM record_access_grants WHERE entity_type='resource' AND entity_id=$1 AND user_id=$2 FOR SHARE",[identity.resourceId,actor.userId])).rows[0];
 if(actor.role!=='admin'&&resource.visibility==='restricted'&&!grant)fail(404,'PROJECT_RESOURCE_UNAVAILABLE','Resource is unavailable');
 return resource;
}
export async function requireProjectAttachmentResource(client,projectId,resourceId,user){
 const actor=await requireProjectWorkAuthority(client,projectId,user.userId);
 return resourceForAttachment(client,{projectId,resourceId},actor);
}

// Shared by browser HTTP and native outbox application. Caller owns BEGIN,
// mandatory audit, receipt and COMMIT. Deleting a link does not delete bytes.
export async function applyProjectWorkAttachment(client,change,user){
 const payload=change.payload||{},record=payload.record||payload;
 const identity=workAttachmentIdentity({...record,project_id:record.project_id??payload.project_id},change.entity_id);
 const actor=await requireProjectWorkAuthority(client,identity.projectId,user.userId);
 const table=identity.parentField==='task_id'?'project_tasks':'project_experiments';
 const parent=(await client.query(`SELECT id FROM ${table} WHERE id=$1 AND project_id=$2 FOR KEY SHARE`,[identity.parentId,identity.projectId])).rows[0];
 const before=(await client.query('SELECT * FROM project_work_attachments WHERE id=$1 FOR UPDATE',[identity.id])).rows[0]??null;
 if(before&&(before[identity.parentField]!==identity.parentId||before.resource_id!==identity.resourceId||before[identity.parentField==='task_id'?'experiment_id':'task_id']))fail(409,'PROJECT_ATTACHMENT_CHANGED','Attachment endpoints changed; refresh and review');
 if(change.operation==='delete'){
  if(!before){
   const deleted=(await client.query("SELECT entity_id FROM sync_tombstones WHERE entity_type='project_work_attachment' AND entity_id=$1 AND project_id=$2",[identity.id,identity.projectId])).rows[0];
   if(!deleted)fail(409,'PROJECT_ATTACHMENT_CHANGED','Attachment is absent without a matching deletion confirmation');
   return {before:null,result:{id:identity.id,deleted:true,already_deleted:true,project_id:identity.projectId}};
  }
  if(!parent)fail(404,'PROJECT_WORK_NOT_FOUND','Work parent not found in project');
  await client.query('DELETE FROM project_work_attachments WHERE id=$1',[identity.id]);
  await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES('project_work_attachment',$1,$2) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[identity.id,identity.projectId]);
  return {before,result:{id:identity.id,deleted:true,project_id:identity.projectId}};
 }
 if(!['create','update'].includes(change.operation))fail(400,'INVALID_PROJECT_ATTACHMENT','Unsupported attachment operation');
 if(!parent)fail(404,'PROJECT_WORK_NOT_FOUND','Work parent not found in project');
 await resourceForAttachment(client,identity,actor);
 if(before)return {before,result:{...before,project_id:identity.projectId}};
 if(change.operation!=='create')fail(409,'PROJECT_ATTACHMENT_CHANGED','Attachment no longer exists');
 if((await client.query("SELECT entity_id FROM sync_tombstones WHERE entity_type='project_work_attachment' AND entity_id=$1",[identity.id])).rowCount)fail(409,'PROJECT_ATTACHMENT_DELETED','A deleted attachment identity cannot be reused');
 let result;
 try{result=(await client.query(`INSERT INTO project_work_attachments(id,${identity.parentField},resource_id,added_by) VALUES($1,$2,$3,$4) RETURNING *`,[identity.id,identity.parentId,identity.resourceId,user.userId])).rows[0];}
 catch(error){if(error.code==='23505')fail(409,'PROJECT_ATTACHMENT_EXISTS','This resource is already attached to the work item; refresh before retrying');throw error;}
 if(!result?.id)fail(500,'PROJECT_ATTACHMENT_CONFIRMATION_MISSING','Database did not confirm the attachment');
 return {before,result:{...result,project_id:identity.projectId}};
}
