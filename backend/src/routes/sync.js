import { syncResponseProjection } from '../sync-receipts.js';
import { moveResourceAttachment, attachmentExpectedRevision } from '../resource-attachment.js';
import { applyResourceMetadata } from '../resource-metadata.js';
import { authorizeEditorCopy } from '../resource-editor-copy.js';
import { applyResourceContentEdit } from '../resource-content-edit.js';
import { authorityIds, resourceAuthority, inheritedResourceAuthority } from '../resource-authority.js';
import { destinationRequests, destinationAuthority } from '../resource-destination-authority.js';
import { confirmationRequest, confirmationReceipt } from '../resource-confirmation.js';
import { applyInventoryMutation, authorizeInventoryImport } from '../inventory-sync.js';
import { applyInventoryRaw } from '../inventory-apply.js';
import { assertReservationStockFloor } from '../reservation-stock.js';
import { applyCommentChange, readComments, authorizeComment } from '../comment-sync.js';
import { applyNotificationRead } from '../notification-sync.js';
import { readableNotifications } from '../middleware/notification-visibility.js';
import { applyCatalogChange, readCatalog, authorizeCatalog, catalogUuid } from '../catalog-sync.js';
import { applyMaintenanceChange } from '../maintenance-sync.js';
import { applyDailyPreferenceChange } from '../daily-preferences.js';
import { applyDownloadSettings } from '../download-settings-sync.js';
import { createDownloadJob } from '../download-queue-create.js';
import { applyDownloadControl, authorizeDownloadControl } from '../download-job-control.js';
import { prepareUploadedResource } from '../resource-upload-staging.js';
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../db.js';
import { getUserPermissions, canReadSensitiveFinance, projectFinancialProjection, transactionResponseProjection } from '../middleware/permissions.js';
import { writeAuditLog } from '../middleware/audit.js';
import { getResourceAccess, requireResourceEditor, validateResourceParent } from '../middleware/resource-access.js';
import { effectiveProjectAccess, getProjectAccess } from '../middleware/project-access.js';
import { canEditRestrictedEntity, isVisibility, visibilityReadSql } from '../middleware/visibility.js';
import { canReadRelationshipEndpoint, canReadKnowledgeRelationship } from '../middleware/knowledge-relationship-access.js';
const router=Router();

function fail(status,code,message){const e=new Error(message);e.status=status;e.code=code;throw e;} function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'INVALID_SYNC_PAYLOAD',`${label} must be an object`);return value;} function resourceLinkLockKey(record){ return ['link',String(record.url||'').trim().replace(/\/+$/,'').toLowerCase(),record.item_id||'',record.project_id||'',record.note_id||'',record.parent_resource_id||''].join('|'); } async function lockResourceLink(client,record){ await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[resourceLinkLockKey(record)]); } function number(value,label){const n=Number(value);if(!Number.isFinite(n))fail(400,'INVALID_SYNC_PAYLOAD',`${label} must be numeric`);return n;} function id(value,label){if(typeof value!=='string'||!/^[0-9a-f-]{32,36}$/i.test(value))fail(400,'INVALID_SYNC_ID',`${label} is invalid`);return value;}
function encodePullCursor(eventAt,eventType,eventId){const raw=JSON.stringify({at:typeof eventAt==='string'?eventAt:new Date(eventAt).toISOString(),type:eventType,id:eventId});return Buffer.from(raw,'utf8').toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decodePullCursor(value){if(!value)return null;try{const padded=value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=');const parsed=JSON.parse(Buffer.from(padded,'base64').toString('utf8'));if(!parsed||typeof parsed.at!=='string'||!parsed.type||typeof parsed.id!=='string')return null;const at=new Date(parsed.at);if(Number.isNaN(at.getTime()))return null;if(parsed.type!=='item'&&parsed.type!=='delete')return null;return{at:parsed.at,type:parsed.type,id:parsed.id};}catch{return null;}}

const PROJECT_ENTITY_CONFIG = {
  project: { table: 'projects', fields: ['name','status','budget','description','priority','start_date','due_date','owner_id','visibility'] },
  project_task: { table: 'project_tasks', fields: ['project_id','title','description','status','priority','assignee_id','due_date','completed_at','created_by'] },
  project_experiment: { table: 'project_experiments', fields: ['project_id','title','status','hypothesis','procedure','observations','result','conclusion','performed_by'] },
  project_bom: { table: 'project_bom_items', fields: ['project_id','name','part_number','required_quantity','unit','preferred_item_id','alternative_item_id','notes','created_by'] },
  project_block: { table: 'project_blocks', fields: ['project_id','block_type','text_content','resource_id','title','x','y','width','height'] },
  project_connector: { table: 'project_connectors', fields: ['project_id','source_block_id','target_block_id','label'] },
  project_experiment_measurement: { table: 'project_experiment_measurements', fields: ['experiment_id','name','value_numeric','value_text','unit','uncertainty','observed_at','recorded_by','notes'] },
  project_experiment_observation: { table: 'project_experiment_observations', fields: ['experiment_id','kind','content','observed_at','recorded_by'] },
  project_task_experiment: { table: 'project_task_experiments', fields: ['project_id','task_id','experiment_id','relationship','created_by'] },
  project_work_attachment: { table: 'project_work_attachments', fields: ['task_id','experiment_id','resource_id','added_by'] },
  project_resource_requirement: { table: 'project_resource_requirements', fields: ['project_id','name','requirement_type','quantity','unit','required_by','preferred_item_id','notes','status','created_by'] }
};
const ENGINEERING_CONFIG={
  engineering_calculation:{table:'engineering_calculations',fields:['project_id','experiment_id','title','category','formula','inputs','result_numeric','result_text','result_unit','visibility','created_by'],permission:{create:'engineering.create',update:'engineering.edit',delete:'engineering.delete'}},
  engineering_test:{table:'engineering_tests',fields:['project_id','title','test_type','description','status','inputs','results','conclusion','visibility','performed_by'],permission:{create:'engineering.create',update:'engineering.edit',delete:'engineering.delete'}}
};
function projectEntityType(value){return Object.prototype.hasOwnProperty.call(PROJECT_ENTITY_CONFIG,value);}
function engineeringEntityType(value){return Object.prototype.hasOwnProperty.call(ENGINEERING_CONFIG,value);}
async function canEditProject(client,projectId,user){
  if(!projectId)return false;
  if(user?.role==='admin')return true;
  if(user?.role==='viewer')return false;
  const result=await client.query("SELECT 1 FROM projects p WHERE p.id=$1 AND (p.owner_id=$2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$2 AND pm.member_role IN ('lead','member'))) AND (p.visibility<>'restricted' OR EXISTS (SELECT 1 FROM record_access_grants g WHERE g.entity_type='project' AND g.entity_id=p.id AND g.user_id=$2 AND g.access_level='edit'))",[projectId,user?.userId]);
  return result.rowCount>0;
}
function validateProjectRecord(entityType,record){
  if(entityType==='project'){
    if(!String(record.name||'').trim())fail(400,'INVALID_PROJECT','Project name is required');
    if(!['planning','active','completed','on_hold','cancelled'].includes(record.status||'planning'))fail(400,'INVALID_PROJECT','Invalid project status');
    if(!['low','normal','high','critical'].includes(record.priority||'normal'))fail(400,'INVALID_PROJECT','Invalid project priority');
    if(Object.hasOwn(record,'visibility')&&!isVisibility(record.visibility))fail(400,'INVALID_PROJECT_VISIBILITY','visibility must be lab, project, or restricted');
  }
  if(entityType==='project_task'){
    if(!String(record.title||'').trim())fail(400,'INVALID_PROJECT_TASK','Task title is required');
    if(!['todo','in_progress','blocked','done','cancelled'].includes(record.status||'todo'))fail(400,'INVALID_PROJECT_TASK','Invalid task status');
    if(!['low','normal','high','critical'].includes(record.priority||'normal'))fail(400,'INVALID_PROJECT_TASK','Invalid task priority');
  }
  if(entityType==='project_experiment'){
    if(!String(record.title||'').trim())fail(400,'INVALID_PROJECT_EXPERIMENT','Experiment title is required');
    if(!['planned','running','completed','failed','cancelled'].includes(record.status||'planned'))fail(400,'INVALID_PROJECT_EXPERIMENT','Invalid experiment status');
  }
  if(entityType==='project_bom'){
    if(!String(record.name||'').trim())fail(400,'INVALID_PROJECT_BOM','BOM item name is required');
    if(!(Number(record.required_quantity)>0))fail(400,'INVALID_PROJECT_BOM','required_quantity must be greater than zero');
  }
  if(entityType==='project_block'){
    if(!['text','image','video','audio','pdf','link','folder'].includes(record.block_type))fail(400,'INVALID_PROJECT_BLOCK','Invalid block type');
    if(record.block_type==='text'&&!record.text_content)fail(400,'INVALID_PROJECT_BLOCK','text_content is required for text blocks');
    if(record.block_type!=='text'&&!record.resource_id)fail(400,'INVALID_PROJECT_BLOCK','resource_id is required for media blocks');
    if(Number(record.width)<120||Number(record.height)<80)fail(400,'INVALID_PROJECT_BLOCK','Canvas block is below the minimum size');
  }
  if(entityType==='project_experiment_measurement'){if(!record.experiment_id||(!record.name)||(record.value_numeric==null&&record.value_text==null))fail(400,'INVALID_MEASUREMENT','Measurement requires experiment_id, name and a numeric or text value');}
  if(entityType==='project_experiment_observation'){if(!record.experiment_id||!String(record.content||'').trim())fail(400,'INVALID_OBSERVATION','Observation requires experiment_id and content');}
  if(entityType==='project_task_experiment'){if(!record.project_id||!record.task_id||!record.experiment_id||!['related','drives','validates','blocked_by'].includes(record.relationship||'related'))fail(400,'INVALID_TASK_EXPERIMENT','Task/experiment link requires project_id, task_id, experiment_id and a valid relationship');}
  if(entityType==='project_work_attachment'){if((!record.task_id&&!record.experiment_id)||(!record.resource_id)||Boolean(record.task_id)&&Boolean(record.experiment_id))fail(400,'INVALID_PROJECT_ATTACHMENT','Attachment requires exactly one work parent and resource_id');}
  if(entityType==='project_connector'){
    if(!record.source_block_id||!record.target_block_id||record.source_block_id===record.target_block_id)fail(400,'INVALID_PROJECT_CONNECTOR','Invalid connector endpoints');
  }
}
async function applyProjectItemEntity(client,change,user){
 const payload=object(change.payload,'Project item sync payload'),record=payload.record||payload.item||payload;
 const projectId=id(record.project_id,'Project ID'),itemId=id(record.item_id||change.entity_id,'Item ID');
 if(!(await canEditProject(client,projectId,user)))fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');
 if(change.operation==='upsert'||change.operation==='create'){
   const result=await client.query('INSERT INTO project_items(project_id,item_id,allocated_quantity,notes) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,item_id) DO UPDATE SET allocated_quantity=EXCLUDED.allocated_quantity,notes=EXCLUDED.notes RETURNING project_id,item_id,allocated_quantity,notes',[projectId,itemId,record.allocated_quantity??0,record.notes??null]);
   return result.rows[0];
 }
 if(change.operation==='delete'){
   const result=await client.query('DELETE FROM project_items WHERE project_id=$1 AND item_id=$2',[projectId,itemId]);
   
   return {project_id:projectId,item_id:itemId,deleted:true};
 }
 fail(400,'UNSUPPORTED_PROJECT_ITEM_OPERATION','Unsupported project item operation: '+change.operation);
}

async function applyProjectTaskExperimentEntity(client,change,user){
  const payload=object(change.payload,'Task/experiment link sync payload');
  const record=payload.record||payload.item||payload;
  const projectId=id(record.project_id,'Project ID');
  const taskId=id(record.task_id,'Task ID');
  const experimentId=id(record.experiment_id,'Experiment ID');
  if(!(await canEditProject(client,projectId,user)))fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');
  const parents=await client.query(
    'SELECT (SELECT project_id FROM project_tasks WHERE id=$1) AS task_project_id,(SELECT project_id FROM project_experiments WHERE id=$2) AS experiment_project_id',
    [taskId,experimentId]
  );
  const parent=parents.rows[0]||{};
  if(parent.task_project_id!==projectId||parent.experiment_project_id!==projectId)fail(400,'INVALID_TASK_EXPERIMENT','Task and experiment must belong to the specified project');
  if(change.operation==='create'||change.operation==='upsert'){
    const relationship=record.relationship||'related';
    if(!['related','drives','validates','blocked_by'].includes(relationship))fail(400,'INVALID_TASK_EXPERIMENT','Invalid task/experiment relationship');
    const linkId=id(record.id||change.entity_id,'Task/experiment link ID');
    const result=await client.query(
      'INSERT INTO project_task_experiments(id,project_id,task_id,experiment_id,relationship,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(task_id,experiment_id) DO UPDATE SET project_id=EXCLUDED.project_id,relationship=EXCLUDED.relationship RETURNING id,project_id,task_id,experiment_id,relationship,created_by,created_at',
      [linkId,projectId,taskId,experimentId,relationship,record.created_by||user.userId]
    );
    return result.rows[0];
  }
  if(change.operation==='delete'){
    const linkId=record.id||change.entity_id;
    if(linkId&&/^[0-9a-f-]{32,36}$/i.test(String(linkId))){
      await client.query('DELETE FROM project_task_experiments WHERE id=$1',[linkId]);
      await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES('project_task_experiment',$1,$2) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[linkId,projectId]);
    }else{
      await client.query('DELETE FROM project_task_experiments WHERE project_id=$1 AND task_id=$2 AND experiment_id=$3',[projectId,taskId,experimentId]);
    }
    return {project_id:projectId,task_id:taskId,experiment_id:experimentId,id:linkId||null,deleted:true};
  }
  fail(400,'UNSUPPORTED_TASK_EXPERIMENT_OPERATION','Unsupported task/experiment link operation: '+change.operation);
}

async function applyProjectEntity(client,change,user){
  const entityType=change.entity_type,cfg=PROJECT_ENTITY_CONFIG[entityType],payload=object(change.payload,'Project sync payload');
  const record=payload.project||payload.item||payload.record||payload;
  const entityId=id(record.id||payload.id||change.entity_id,'Project entity ID');
  const isNestedParentless=['project_experiment_measurement','project_experiment_observation','project_work_attachment'].includes(entityType);
  let existing=null;
  if(change.operation!=='create'){
    const result=await client.query('SELECT * FROM '+cfg.table+' WHERE id=$1 FOR UPDATE',[entityId]);
    existing=result.rows[0]||null;
    if(!existing&&change.operation==='delete')return{deleted:true,id:entityId,already_deleted:true};
    if(!existing)fail(409,'PROJECT_ENTITY_NOT_FOUND',entityType+' '+entityId+' does not exist on the server');
  }
  let projectId=entityType==='project'?entityId:record.project_id||existing?.project_id||null;
  if(isNestedParentless){
    if(entityType==='project_experiment_measurement'||entityType==='project_experiment_observation'){
      const experimentId=record.experiment_id||existing?.experiment_id;
      if(!experimentId)fail(400,'INVALID_PROJECT_REFERENCE','experiment_id is required');
      const parent=await client.query('SELECT project_id FROM project_experiments WHERE id=$1',[experimentId]);
      projectId=parent.rows[0]?.project_id||null;
      if(existing&&record.experiment_id&&String(record.experiment_id)!==String(existing.experiment_id))fail(400,'INVALID_PROJECT_REFERENCE','Cannot move a measurement or observation between experiments');
    }else{
      const taskId=record.task_id||existing?.task_id;
      const experimentId=record.experiment_id||existing?.experiment_id;
      if(Boolean(taskId)===Boolean(experimentId))fail(400,'INVALID_PROJECT_ATTACHMENT','Attachment requires exactly one work parent');
      if(existing&&record.task_id&&String(record.task_id)!==String(existing.task_id||''))fail(400,'INVALID_PROJECT_ATTACHMENT','Cannot move an attachment between work parents');
      if(existing&&record.experiment_id&&String(record.experiment_id)!==String(existing.experiment_id||''))fail(400,'INVALID_PROJECT_ATTACHMENT','Cannot move an attachment between work parents');
      const work=taskId||experimentId;
      const parent=await client.query('SELECT project_id FROM project_tasks WHERE id=$1 UNION ALL SELECT project_id FROM project_experiments WHERE id=$1 LIMIT 1',[work]);
      projectId=parent.rows[0]?.project_id||null;
    }
  }
  if(entityType!=='project'&&!(await canEditProject(client,projectId,user)))fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');
  if(entityType==='project'&&change.operation!=='create'&&!(await canEditProject(client,entityId,user)))fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');
  if(entityType==='project'&&Object.hasOwn(record,'budget')&&change.operation!=='delete'){
    const permissions=await getUserPermissions(user.userId,user.role);
    if(!permissions.has('finance.edit'))fail(403,'PERMISSION_DENIED','Permission required: finance.edit to synchronize project budgets');
  }
  if(entityType==='project'&&change.operation==='create'&&record.owner_id&&record.owner_id!==user.userId&&user.role!=='admin')fail(403,'PROJECT_OWNER_DENIED','Only administrators can assign another project owner during synchronization');
  validateProjectRecord(entityType,record);
  if(entityType==='project'&&change.operation==='update'&&existing?.status==='planning'&&record.status==='active')fail(409,'PROJECT_REVIEW_REQUIRED','Submit the plan for online admin review before activation');
  if(entityType==='project'&&change.operation==='create'&&user?.role!=='admin'&&record.status&&record.status!=='planning')fail(403,'PROJECT_ACTIVATION_REQUIRES_ADMIN','New projects must begin in Planning');
  if(entityType==='project'&&change.operation==='update'&&record.status==='active'&&existing?.status!=='active'&&user?.role!=='admin')fail(403,'PROJECT_ACTIVATION_REQUIRES_ADMIN','Only admins can activate projects');
  if(change.operation==='create'){
    if(existing)return existing;
    if(entityType!=='project'&&!projectId)fail(400,'INVALID_PROJECT_REFERENCE','project_id is required');
    const values=[entityId],columns=['id'];
    for(const field of cfg.fields){
      if(field==='owner_id'&&entityType==='project'&&!record.owner_id){columns.push(field);values.push(user.userId);continue;}
      if(Object.prototype.hasOwnProperty.call(record,field)){columns.push(field);values.push(record[field]??null);}
    }
    if(entityType==='project_connector'){
      const checks=await client.query('SELECT id,project_id FROM project_blocks WHERE id=ANY($1::uuid[])',[[record.source_block_id,record.target_block_id]]);
      if(checks.rowCount!==2||checks.rows.some(row=>row.project_id!==projectId))fail(400,'INVALID_PROJECT_CONNECTOR','Connector blocks must belong to this project');
    }
    const placeholders=values.map((_,i)=>'$'+(i+1)).join(',');
    const created=(await client.query('INSERT INTO '+cfg.table+' ('+columns.join(',')+') VALUES ('+placeholders+') RETURNING *',values)).rows[0];
    if(entityType==='project'&&created.owner_id)await client.query("INSERT INTO project_members(project_id,user_id,member_role) VALUES($1,$2,'lead') ON CONFLICT(project_id,user_id) DO NOTHING",[entityId,created.owner_id]);
    if(entityType==='project'&&created.visibility==='restricted')await client.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('project',$1,$2,'edit',$2) ON CONFLICT(entity_type,entity_id,user_id) DO UPDATE SET access_level='edit'",[entityId,user.userId]);
    return created;
  }
  if(change.operation==='update'){
    const updates=[],values=[];
    for(const field of cfg.fields){
      if(['project_id','created_by','owner_id'].includes(field))continue;
      if(Object.prototype.hasOwnProperty.call(record,field)){values.push(record[field]??null);updates.push(field+'=$'+values.length);}
    }
    if(!updates.length)return existing;
    updates.push('updated_at=now()');values.push(entityId);
    const updated=(await client.query('UPDATE '+cfg.table+' SET '+updates.join(',')+' WHERE id=$'+values.length+' RETURNING *',values)).rows[0];
    if(entityType==='project'&&existing.visibility!==updated.visibility&&updated.visibility==='restricted')await client.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('project',$1,$2,'edit',$2) ON CONFLICT(entity_type,entity_id,user_id) DO UPDATE SET access_level='edit'",[entityId,user.userId]);
    if(entityType==='project'&&existing.visibility==='restricted'&&updated.visibility!=='restricted')await client.query("DELETE FROM record_access_grants WHERE entity_type='project' AND entity_id=$1",[entityId]);
    return updated;
  }
  if(change.operation==='delete'){
    if(entityType==='project')await client.query("DELETE FROM record_access_grants WHERE entity_type='project' AND entity_id=$1",[entityId]);
    const result=await client.query('DELETE FROM '+cfg.table+' WHERE id=$1 RETURNING id',[entityId]);
    if(result.rowCount)await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES($1,$2,$3) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[entityType,entityId,projectId]);
    return{deleted:Boolean(result.rowCount),id:entityId};
  }
  fail(400,'UNSUPPORTED_PROJECT_OPERATION','Unsupported project operation: '+change.operation);
}

const RESOURCE_FIELDS=['name','kind','file_type','original_filename','mime_type','size_bytes','parent_resource_id','relative_path','url','thumbnail_url','item_id','project_id','note_id','category','description','tags','visibility'];
async function applyResourceEntity(client,change,user){
 if(change.operation==='edit_content')return applyResourceContentEdit(client,change,user);
 if(change.operation==='edit_metadata')return applyResourceMetadata(client,change,user);
 const payload=object(change.payload,'Resource sync payload'),record=payload.resource||payload.record||payload,entityId=id(record.id||payload.id||change.entity_id,'Resource ID');
 // A distinct operation makes older servers reject rather than silently ACK
 // this as a metadata update with no recognized fields.
 if(change.operation==='attach'){
  const move=object(payload.attachment,'Resource attachment');
  if(record.id&&record.id!==change.entity_id)fail(400,'INVALID_SYNC_ID','Resource identity does not match the queued change');
  const expected=await attachmentExpectedRevision(client,move,change,user);
  return moveResourceAttachment(client,entityId,user,move.destination,expected);
 }
 if(change.operation==='create'||change.operation==='create_copy'){
  const permissions=await getUserPermissions(user.userId,user.role);
  if(!permissions.has('resources.create'))fail(403,'PERMISSION_DENIED','Permission required: resources.create');
  if(change.operation==='create_copy'){
   if(!permissions.has('resources.edit'))fail(403,'PERMISSION_DENIED','Permission required: resources.edit');
   await authorizeEditorCopy(client,record,payload.copy,user,change);
  }else if(record.derived_from_resource_id!=null)fail(400,'EDITOR_COPY_OPERATION_REQUIRED','Use a guarded editor copy intent');
  if(!['link','folder','file'].includes(String(record.kind||'')))fail(400,'UNSUPPORTED_RESOURCE_CREATE','Unsupported resource kind');
  if(record.kind==='file'){
   const parent=await validateResourceParent({itemId:record.item_id,projectId:record.project_id,noteId:record.note_id,parentResourceId:record.parent_resource_id,user});
   if(!parent.ok)fail(parent.status,parent.error?.code||'RESOURCE_PARENT_DENIED',parent.error?.message||'Resource parent is unavailable');
  }
  if(!String(record.name||'').trim())fail(400,'INVALID_RESOURCE','Resource name is required');
  const visibility=record.visibility??'lab';
  if(!isVisibility(visibility))fail(400,'INVALID_RESOURCE_VISIBILITY','visibility must be lab, project, or restricted');
  const parents=[record.item_id,record.project_id,record.note_id].filter(Boolean);
  if(parents.length>1)fail(400,'INVALID_RESOURCE_PARENT','A resource can be attached to at most one parent context');
  if(record.project_id){
   const access=await getProjectAccess(record.project_id,{userId:user.userId,role:user.role});
   if(!['edit','admin'].includes(access.access))fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');
  }
  if(record.note_id){
   const note=await client.query('SELECT id,project_id FROM notes WHERE id=$1',[record.note_id]);
   if(!note.rowCount)fail(404,'NOTE_NOT_FOUND','Note not found');
   if(note.rows[0].project_id){
    const access=await getProjectAccess(note.rows[0].project_id,{userId:user.userId,role:user.role});
    if(!['edit','admin'].includes(access.access))fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this note project');
   }
  }
  if(record.parent_resource_id){
   const access=await requireResourceEditor(record.parent_resource_id,{userId:user.userId,role:user.role});
   if(!access.ok)fail(access.status,access.error.code,access.error.message);
  }
  const existing=await client.query('SELECT * FROM resources WHERE id=$1',[entityId]);
  if(existing.rowCount)fail(409,'RESOURCE_ALREADY_EXISTS',`Resource ${entityId} already exists`);
  if(record.kind==='link'&&record.url){ await lockResourceLink(client,record); const duplicate=await client.query("SELECT * FROM resources WHERE kind='link' AND lower(btrim(url))=lower($1) AND item_id IS NOT DISTINCT FROM $2 AND project_id IS NOT DISTINCT FROM $3 AND note_id IS NOT DISTINCT FROM $4 AND parent_resource_id IS NOT DISTINCT FROM $5 ORDER BY (local_media_path IS NOT NULL) DESC, created_at ASC LIMIT 1",[String(record.url).trim().replace(/\/+$/,''),record.item_id||null,record.project_id||null,record.note_id||null,record.parent_resource_id||null]); if(duplicate.rowCount)return duplicate.rows[0]; }
  const values=[entityId],columns=['id'];
  for(const field of RESOURCE_FIELDS){
   if(field==='file_type'&&record.kind==='folder'&&!record.file_type){columns.push(field);values.push('schematic_folder');continue;}
   if(Object.prototype.hasOwnProperty.call(record,field)){
    const value=field==='url'&&record.url!=null ? String(record.url).trim().replace(/\/+$/,'') : record[field];
    columns.push(field);values.push(value??null);
   }
  }
  columns.push('uploaded_by');values.push(user.userId);
  if(change.operation==='create_copy'){columns.push('derived_from_resource_id');values.push(record.derived_from_resource_id);}
  if(record.kind==='file'){columns.push('storage_path');values.push(await prepareUploadedResource(client,change,user,record));}
  const placeholders=values.map((_,i)=>'$'+(i+1)).join(',');
  const created=(await client.query('INSERT INTO resources ('+columns.join(',')+') VALUES ('+placeholders+') RETURNING *',values)).rows[0];
  if(record.kind==='file')await writeAuditLog({req:{user},actorUserId:user.userId,action:'sync:create',entityType:'resource',entityId, newValue:created,deviceId:change.__device_id||null,client,required:true,metadata:{sync_mode:'online',source:'offline-file-upload'}});
  if(visibility==='restricted')await client.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('resource',$1,$2,'edit',$2) ON CONFLICT(entity_type,entity_id,user_id) DO UPDATE SET access_level='edit'",[entityId,user.userId]);
  return created;
 }
 const existing=await client.query('SELECT * FROM resources WHERE id=$1 FOR UPDATE',[entityId]);
 if(!existing.rowCount&&change.operation==='delete')return{id:entityId,deleted:true,already_deleted:true};
 if(!existing.rowCount)fail(409,'RESOURCE_NOT_FOUND',`Resource ${entityId} does not exist on the server`);
 const access=await requireResourceEditor(entityId,{userId:user.userId,role:user.role});
 if(!access.ok)fail(access.status,access.error.code,access.error.message);
 if(change.operation==='update'){
  const updates=[],values=[];
  if(Object.prototype.hasOwnProperty.call(record,'visibility')&&!isVisibility(record.visibility))fail(400,'INVALID_RESOURCE_VISIBILITY','visibility must be lab, project, or restricted');
  for(const field of ['category','description','tags','visibility'])if(Object.prototype.hasOwnProperty.call(record,field)){values.push(record[field]??null);updates.push(field+'=$'+values.length);}
  if(!updates.length)return existing.rows[0];
  values.push(entityId);
  const updated=(await client.query('UPDATE resources SET '+updates.join(',')+' WHERE id=$'+values.length+' RETURNING *',values)).rows[0];
  if(existing.rows[0].visibility!==updated.visibility&&updated.visibility==='restricted')await client.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('resource',$1,$2,'edit',$2) ON CONFLICT(entity_type,entity_id,user_id) DO UPDATE SET access_level='edit'",[entityId,user.userId]);
  if(existing.rows[0].visibility==='restricted'&&updated.visibility!=='restricted')await client.query("DELETE FROM record_access_grants WHERE entity_type='resource' AND entity_id=$1",[entityId]);
  return updated;
 }
 if(change.operation==='delete'){
  const projectId=existing.rows[0]?.project_id||null,itemId=existing.rows[0]?.item_id||null,noteId=existing.rows[0]?.note_id||null;
  await client.query("DELETE FROM record_access_grants WHERE entity_type='resource' AND entity_id=$1",[entityId]);
  await client.query('DELETE FROM resources WHERE id=$1',[entityId]);
  await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id,item_id,note_id) VALUES('resource',$1,$2,$3,$4) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id,item_id=EXCLUDED.item_id,note_id=EXCLUDED.note_id",[entityId,projectId,itemId,noteId]);
  return{id:entityId,deleted:true};
 }
 fail(400,'UNSUPPORTED_RESOURCE_OPERATION','Unsupported resource operation: '+change.operation);
}

async function applyResourceDownloadJobEntity(client,change,user){return change.operation==='create'?createDownloadJob(client,change,user):applyDownloadControl(client,change,user);}

const FINANCE_CONFIG={transaction:{table:'transactions',permission:{create:'finance.create_expense',update:'finance.edit',delete:'finance.delete'}},budget_period:{table:'budget_periods',permission:{create:'finance.edit',update:'finance.edit',delete:'finance.delete'}},funding_source:{table:'funding_sources',permission:{create:'finance.edit',update:'finance.edit',delete:'finance.delete'}}};async function applyFinanceEntity(client,change,user){const cfg=FINANCE_CONFIG[change.entity_type],required=change.entity_type==='transaction'&&change.operation==='create'?null:cfg?.permission?.[change.operation];if(required){const permissions=await getUserPermissions(user.userId,user.role);if(!permissions.has(required))fail(403,'PERMISSION_DENIED',`Permission required: ${required}`);}const payload=object(change.payload,'Finance sync payload'),record=payload.transaction||payload.budget_period||payload.funding_source||payload.record||payload,entityId=id(record.id||payload.id||change.entity_id,'Finance ID');const existing=await client.query(`SELECT * FROM ${cfg.table} WHERE id=$1`,[entityId]);if(change.operation==='create'){if(existing.rowCount)fail(409,'FINANCE_ALREADY_EXISTS',`Finance record ${entityId} already exists`);}else if(!existing.rowCount&&change.operation==='delete')return{id:entityId,deleted:true,already_deleted:true};else if(!existing.rowCount)fail(409,'FINANCE_NOT_FOUND',`Finance record ${entityId} does not exist`);if(cfg.table==='transactions'){
  const permissions=await getUserPermissions(user.userId,user.role);
  const previous=existing.rows[0]||null;
  const nextDirection=change.operation==='create'?record.direction:(record.direction??previous?.direction);
  if(change.operation==='create'){
    if(nextDirection!=='income'&&nextDirection!=='expense')fail(400,'INVALID_TRANSACTION','Invalid direction');
    const needed=nextDirection==='income'?'finance.create_income':'finance.create_expense';
    if(!permissions.has(needed))fail(403,'PERMISSION_DENIED',`Permission required: ${needed}`);
  }
  if((previous?.direction==='income'||nextDirection==='income')&&!canReadSensitiveFinance(permissions))
    fail(403,'PERMISSION_DENIED','Sensitive finance access required');
  const previousProject=previous?.project_id||null;
  const nextProject=change.operation==='delete'?null:(record.project_id===undefined?previousProject:record.project_id||null);
  for(const projectId of new Set([previousProject,nextProject].filter(Boolean))){
    const access=await getProjectAccess(projectId,user);
    if(access.access!=='edit'&&access.access!=='admin')fail(403,'PROJECT_EDIT_DENIED','Project edit access required for finance change');
  }
}else if(!((await getUserPermissions(user.userId,user.role)).has('finance.view_sensitive'))){
  fail(403,'PERMISSION_DENIED','Sensitive finance access required for funding and budget changes');
}
if(change.operation==='delete'){const projectId=record.project_id||existing.rows[0]?.project_id||null;await client.query(`DELETE FROM ${cfg.table} WHERE id=$1`,[entityId]);await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES($1,$2,$3) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[change.entity_type,entityId,projectId]);return{id:entityId,deleted:true};}const allowed=cfg.table==='transactions'?['type','direction','amount','date','vendor','notes','item_id','project_id','funding_source_id','budget_period_id']:cfg.table==='budget_periods'?['label','total_budget','start_date','end_date','notes']:['name','source_type','contact_info','notes'];const fields=allowed.filter(k=>Object.prototype.hasOwnProperty.call(record,k));if(change.operation==='create'&&cfg.table==='transactions'&&!fields.includes('direction'))fail(400,'INVALID_TRANSACTION','direction is required');if(change.operation==='create'){const cols=['id',...fields],vals=[entityId,...fields.map(k=>record[k]??null)];if(cfg.table==='transactions'){cols.push('logged_by');vals.push(user.userId);}return(await client.query(`INSERT INTO ${cfg.table} (${cols.join(',')}) VALUES (${vals.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,vals)).rows[0];}if(!fields.length)return existing.rows[0];const sets=fields.map((field,i)=>field+'=$'+(i+1)),vals=fields.map(k=>record[k]??null);vals.push(entityId);return(await client.query(`UPDATE ${cfg.table} SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`,vals)).rows[0];}
const LOCATION_FIELDS=['name','parent_id','created_at'];
async function applyLocationEntity(client,change,{userId,role}){ const permissions=await getUserPermissions(userId,role);
 const needed=change.operation==='create'?'inventory.create':change.operation==='update'?'inventory.edit':'inventory.delete';
 if(!permissions.has(needed))fail(403,'PERMISSION_DENIED',`Permission required: ${needed}`);
 const payload=object(change.payload,'Location sync payload');
 const record=payload.location||payload.record||payload;
 if(change.operation==='create'){
  if(!String(record.name||'').trim())fail(400,'INVALID_LOCATION','Location name is required');
  const locationId=change.entity_id||record.id||null;
  if(!locationId)fail(400,'INVALID_LOCATION','Location id is required');
  id(locationId,'Location id');
  const result=await client.query('INSERT INTO locations (id,name,parent_id,created_at) VALUES ($1,$2,$3,COALESCE($4,now())) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,parent_id=EXCLUDED.parent_id RETURNING *',[locationId,String(record.name).trim(),record.parent_id||null,record.created_at||null]);
  return {location:result.rows[0]};
 }
 if(!change.entity_id)fail(400,'INVALID_LOCATION','Location id is required');
 id(change.entity_id,'Location id');
 const existing=await client.query('SELECT * FROM locations WHERE id=$1',[change.entity_id]);
 if(change.operation==='update'){
  if(!existing.rowCount)fail(404,'LOCATION_NOT_FOUND','Location not found');
  if(record.parent_id===change.entity_id)fail(400,'INVALID_LOCATION','A location cannot be its own parent');
  const result=await client.query('UPDATE locations SET name=COALESCE($1,name),parent_id=$2 WHERE id=$3 RETURNING *',[record.name===undefined?null:String(record.name).trim()||null,record.parent_id===undefined?existing.rows[0].parent_id:record.parent_id,change.entity_id]);
  return {location:result.rows[0]};
 }
 if(change.operation==='delete'){
  if(!existing.rowCount) return {deleted:change.entity_id};
  await client.query('DELETE FROM locations WHERE id=$1',[change.entity_id]);
  await client.query("INSERT INTO sync_tombstones(entity_type,entity_id) VALUES('location',$1) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now()",[change.entity_id]);
  return {deleted:change.entity_id};
 }
 fail(400,'UNSUPPORTED_SYNC_CHANGE',`Unsupported location operation: ${change.operation}`);
}

async function applyEngineeringEntity(client,change,user){
 const cfg=ENGINEERING_CONFIG[change.entity_type];
 if(!cfg)fail(400,'UNSUPPORTED_ENGINEERING_ENTITY','Unsupported engineering entity');
 const required=cfg.permission?.[change.operation];
 if(required){
  const permissions=await getUserPermissions(user.userId,user.role);
  if(!permissions.has(required))fail(403,'PERMISSION_DENIED',`Permission required: ${required}`);
 }
 const payload=object(change.payload,'Engineering sync payload');
 const record=object(payload.record||payload.calculation||payload.test||payload,'Engineering record');
 const entityId=id(record.id||payload.id||change.entity_id,'Engineering entity ID');
 const table=cfg.table;
 const existing=await client.query('SELECT * FROM '+table+' WHERE id=$1 FOR UPDATE',[entityId]);
 if(change.operation==='create'){
  if(record.project_id&&!(await canEditProject(client,record.project_id,user)))fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');
  const visibility=record.visibility??'lab';
  if(!isVisibility(visibility)||visibility==='project'&&!record.project_id)fail(400,'INVALID_ENGINEERING_VISIBILITY','Invalid engineering visibility or missing project');
  if(!String(record.title||'').trim())fail(400,'INVALID_ENGINEERING_RECORD','title is required');
  if(existing.rowCount)fail(409,'ENGINEERING_ID_COLLISION','Engineering entity ID already exists');
  const fields=cfg.fields.filter(f=>!['created_by','performed_by'].includes(f)&&Object.prototype.hasOwnProperty.call(record,f));
  const cols=['id',...fields],vals=[entityId,...fields.map(f=>record[f]??null)];
  if(!fields.includes('created_by')&&table==='engineering_calculations'){cols.push('created_by');vals.push(user.userId);}
  if(!fields.includes('performed_by')&&table==='engineering_tests'){cols.push('performed_by');vals.push(user.userId);}
  const result=await client.query('INSERT INTO '+table+' ('+cols.join(',')+') VALUES ('+vals.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',vals);
  if(visibility==='restricted')await client.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES($1,$2,$3,'edit',$3) ON CONFLICT(entity_type,entity_id,user_id) DO UPDATE SET access_level='edit'",[change.entity_type,entityId,user.userId]);
  return result.rows[0];
 }
 if(existing.rowCount){
  const current=existing.rows[0];
  if(current.project_id&&!(await canEditProject(client,current.project_id,user)))fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');
  if(current.visibility==='restricted'&&!(await canEditRestrictedEntity({entityType:change.entity_type,entityId,user})))fail(403,'RECORD_ACCESS_DENIED','You do not have edit access to this engineering record');
 }
 if(change.operation==='update'){
  if(!existing.rowCount)fail(404,'ENGINEERING_NOT_FOUND','Engineering record not found');
  if(record.visibility!==undefined&&record.visibility!==existing.rows[0].visibility)fail(400,'VISIBILITY_CHANGE_UNSUPPORTED','Engineering visibility changes require grant administration');
  const fields=cfg.fields.filter(f=>!['project_id','visibility','created_by','performed_by'].includes(f)&&Object.prototype.hasOwnProperty.call(record,f));
  if(!fields.length)return existing.rows[0];
  const vals=fields.map(f=>record[f]??null);
  vals.push(entityId);
  const result=await client.query('UPDATE '+table+' SET '+fields.map((f,i)=>f+'=$'+(i+1)).join(',')+' WHERE id=$'+(fields.length+1)+' RETURNING *',vals);
  return result.rows[0];
 }
 if(change.operation==='delete'){
  if(!existing.rowCount)return {deleted:entityId};
  const projectId=existing.rows[0].project_id||null;
  await client.query('DELETE FROM '+table+' WHERE id=$1',[entityId]);
  await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES($1,$2,$3) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[change.entity_type,entityId,projectId]);
  return {deleted:entityId};
 }
 fail(400,'UNSUPPORTED_ENGINEERING_OPERATION','Unsupported engineering operation: '+change.operation);
}


router.get('/notes/pull',async(req,res,next)=>{
  try{
    const permissions=await getUserPermissions(req.user.userId,req.user.role);if(!permissions.has('notes.view'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: notes.view'}});
    const notes=await pool.query(`SELECT n.* FROM notes n WHERE ${visibilityReadSql({alias:'n',entityType:'note',userIdParameter:'$1',roleParameter:'$2'})} ORDER BY n.updated_at DESC`,[req.user.userId,req.user.role]);
    const tomb=await pool.query("SELECT entity_id FROM sync_tombstones WHERE entity_type='note' AND $1='admin' ORDER BY deleted_at DESC LIMIT 1000",[req.user.role]);
    res.setHeader('Cache-Control','no-store');res.json({notes:notes.rows,visible_note_ids:notes.rows.map(row=>row.id),deleted_note_ids:tomb.rows.map(r=>r.entity_id)});
  }catch(e){next(e);}
});

router.get('/comments/pull',async(req,res,next)=>{try{res.json(await readComments(req.user));}catch(e){if(e.status)return res.status(e.status).json({error:{code:e.code,message:e.message}});next(e);}});
router.get('/notifications/pull',async(req,res,next)=>{try{res.json({records:await readableNotifications(req.user),snapshot_complete:true});}catch(error){next(error);}});
router.get('/catalog/:type/pull',async(req,res,next)=>{try{res.json({records:await readCatalog(req.params.type,req.user),snapshot_complete:true});}catch(e){if(e.status)return res.status(e.status).json({error:{code:e.code,message:e.message}});next(e);}});
router.get('/maintenance/pull',async(req,res,next)=>{
  try {
    const permissions=await getUserPermissions(req.user.userId,req.user.role);
    if(!permissions.has('inventory.view'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: inventory.view'}});
    const rows=await pool.query('SELECT m.*,u.username AS performed_by_username FROM maintenance_records m LEFT JOIN users u ON u.id=m.performed_by ORDER BY m.id');
    res.setHeader('Cache-Control','no-store');
    res.json({snapshot_complete:true,records:rows.rows});
  } catch(error) {next(error);}
});

router.get('/locations/pull',async(req,res,next)=>{
 try{
  const permissions=await getUserPermissions(req.user.userId,req.user.role);
  if(!permissions.has('inventory.view'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: inventory.view'}});
  const result=await pool.query('SELECT l.*,COUNT(i.id)::int AS item_count FROM locations l LEFT JOIN items i ON i.location_id=l.id GROUP BY l.id ORDER BY l.created_at DESC,l.name ASC');
  const tomb=await pool.query("SELECT entity_id FROM sync_tombstones WHERE entity_type='location' ORDER BY deleted_at DESC LIMIT 1000");
  res.setHeader('Cache-Control','no-store');res.json({snapshot_complete:true,locations:result.rows,deleted_location_ids:tomb.rows.map(r=>r.entity_id)});
 }catch(e){next(e);}
});

router.get('/finance/pull',async(req,res,next)=>{
  try {
    const permissions=await getUserPermissions(req.user.userId,req.user.role);
    if(!permissions.has('finance.view'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: finance.view'}});
    const sensitive=canReadSensitiveFinance(permissions);
    const transactions=await pool.query(`SELECT * FROM transactions WHERE ${linkedProjectReadSql('transactions.project_id','$1','$2')} ${sensitive?'':"AND direction = 'expense'"} ORDER BY created_at DESC`,[req.user.userId,req.user.role]);
    const [budget_periods,funding_sources]=sensitive?await Promise.all([
      pool.query('SELECT * FROM budget_periods ORDER BY start_date DESC NULLS LAST,created_at DESC'),
      pool.query('SELECT * FROM funding_sources ORDER BY created_at DESC')
    ]):[{rows:[]},{rows:[]}];
    const tomb=await pool.query("SELECT entity_type,entity_id FROM sync_tombstones WHERE entity_type IN ('transaction','budget_period','funding_source') ORDER BY deleted_at DESC LIMIT 1000");
    const deleted={transaction:[],budget_period:[],funding_source:[]};
    for(const r of tomb.rows)if(deleted[r.entity_type]&&sensitive)deleted[r.entity_type].push(r.entity_id);
    res.setHeader('Cache-Control','no-store');
    res.json({snapshot_complete:true,sensitive_access:sensitive,transactions:transactions.rows.map(row=>transactionResponseProjection(row,permissions)),budget_periods:budget_periods.rows,funding_sources:funding_sources.rows,deleted,deleted_transactions:deleted.transaction,deleted_budget_period:deleted.budget_period,deleted_budget_periods:deleted.budget_period,deleted_funding_sources:deleted.funding_source});
  }catch(e){next(e);}
});
async function verifiedResourceAuthority(resourceId,user,allowed){
  let before,after,beforeRows,afterRows,editable=false;
  if(allowed){
    before=(await pool.query('SELECT id,updated_at,visibility,item_id,project_id,note_id,parent_resource_id FROM resources WHERE id=$1',[resourceId])).rows[0];
    if(before){
      const access=await requireResourceEditor(resourceId,user);
      const recheck=await requireResourceEditor(resourceId,user);
      editable=access.ok&&recheck.ok;beforeRows=access.context?.resources;afterRows=recheck.context?.resources;
      after=(await pool.query('SELECT id,updated_at,visibility,item_id,project_id,note_id,parent_resource_id FROM resources WHERE id=$1',[resourceId])).rows[0];
    }
  }
  return inheritedResourceAuthority(resourceId,before,after,editable,beforeRows,afterRows);
}

router.post('/resources/confirm',async(req,res,next)=>{
  try{
    const request=confirmationRequest(req.body);
    const rows=(await pool.query('SELECT change_id,user_id,device_id,entity_type,entity_id,operation,payload_json,response_json FROM sync_idempotency WHERE change_id=ANY($1::text[]) AND user_id=$2 AND device_id=$3',[request.change_ids,req.user.userId,request.device_id])).rows;
    const receipts=request.change_ids.map(id=>confirmationReceipt(id,rows.find(row=>row.change_id===id),request,req.user.userId));
    const permissions=await getUserPermissions(req.user.userId,req.user.role);
    const grant=await verifiedResourceAuthority(request.resource_id,req.user,permissions.has('resources.view')&&permissions.has('resources.edit'));
    res.setHeader('Cache-Control','no-store');
    res.json({protocol:request.protocol??1,account_id:req.user.userId,receipts,authority:{protocol:2,account_id:req.user.userId,grants:[grant]}});
  }catch(error){next(error);}
});

// POST carries only a bounded ID list; this endpoint never mutates lab data.
router.post('/resources/authority',async(req,res,next)=>{
  try {
    const ids=authorityIds(req.body?.resource_ids);
    const protocol=req.body?.protocol??1;
    if(![1,2].includes(protocol)||(protocol===2&&ids.length>4))return res.status(400).json({error:{code:'INVALID_RESOURCE_AUTHORITY_REQUEST',message:'Protocol 2 requires at most four resources per request'}});
    const permissions=await getUserPermissions(req.user.userId,req.user.role);
    const allowed=permissions.has('resources.view')&&permissions.has('resources.edit');
    const grants=[];
    for(const resourceId of ids){
      if(protocol===2){grants.push(await verifiedResourceAuthority(resourceId,req.user,allowed));continue;}
      let before,after,editable=false;
      if(allowed){
        before=(await pool.query('SELECT id,updated_at,visibility,item_id,project_id,note_id,parent_resource_id FROM resources WHERE id=$1',[resourceId])).rows[0];
        if(before){
          const access=await requireResourceEditor(resourceId,req.user);
          editable=access.ok;
          after=(await pool.query('SELECT id,updated_at,visibility,item_id,project_id,note_id,parent_resource_id FROM resources WHERE id=$1',[resourceId])).rows[0];
        }
      }
      grants.push(resourceAuthority(resourceId,before,after,editable));
    }
    res.setHeader('Cache-Control','no-store');
    res.json({protocol,account_id:req.user.userId,grants});
  }catch(error){next(error);}
});

// Derived destination authority; never a grant or domain mutation supplied by UI.
router.post('/resources/destination-authority',async(req,res,next)=>{
  try{
    const requests=destinationRequests(req.body?.destinations);
    const permissions=await getUserPermissions(req.user.userId,req.user.role);
    const permitted=permissions.has('resources.view')&&(permissions.has('resources.create')||permissions.has('resources.edit'));
    const grants=[];
    for(const request of requests){
      const query=request.kind==='note'?'SELECT id,project_id,visibility FROM notes WHERE id=$1':'SELECT id,visibility FROM projects WHERE id=$1';
      let before,after,allowed=false;
      if(permitted){
        before=(await pool.query(query,[request.id])).rows[0];
        if(before){
          const access=await validateResourceParent({noteId:request.kind==='note'?request.id:null,projectId:request.kind==='project'?request.id:null,user:req.user,requireEdit:true});
          allowed=access.ok;
          after=(await pool.query(query,[request.id])).rows[0];
        }
      }
      grants.push(destinationAuthority(request,before,after,allowed));
    }
    res.setHeader('Cache-Control','no-store');
    res.json({protocol:1,account_id:req.user.userId,grants});
  }catch(error){next(error);}
});

router.get('/resources/pull',async(req,res,next)=>{
  try{
    const permissions=await getUserPermissions(req.user.userId,req.user.role);
    if(!permissions.has('resources.view'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: resources.view'}});
    const result=await pool.query('SELECT r.id,r.name,r.kind,r.file_type,r.original_filename,r.mime_type,r.size_bytes,r.parent_resource_id,r.relative_path,r.url,r.thumbnail_url,r.category,r.description,r.tags,r.visibility,r.updated_at,r.created_at,r.item_id,r.project_id,r.note_id,r.derived_from_resource_id FROM resources r ORDER BY r.updated_at DESC');
    const visible=[];
    for(const row of result.rows){const access=await getResourceAccess(row.id,req.user);if(access.access!=='none'&&!access.context?.invalid)visible.push(row);}
    const deletedRows=await pool.query("SELECT entity_id,project_id,item_id,note_id FROM sync_tombstones WHERE entity_type='resource' ORDER BY deleted_at DESC LIMIT 500");
    const deleted=[];
    for(const row of deletedRows.rows){
      if(req.user.role==='admin'){deleted.push(row.entity_id);continue;}
      if(row.project_id){const access=await getProjectAccess(row.project_id,req.user);if(access.access!=='none')deleted.push(row.entity_id);continue;}
      if(row.note_id){const access=await validateResourceParent({noteId:row.note_id,user:req.user,requireEdit:false});if(access.ok)deleted.push(row.entity_id);continue;}
      if(row.item_id){const access=await validateResourceParent({itemId:row.item_id,user:req.user,requireEdit:false});if(access.ok)deleted.push(row.entity_id);continue;}
      deleted.push(row.entity_id);
    }
    res.setHeader('Cache-Control','no-store');
    res.json({resources:visible,visible_resource_ids:visible.map(row=>row.id),deleted_resource_ids:deleted});
  }catch(error){next(error);}
});

router.get('/engineering/pull',async(req,res,next)=>{
 try{
  const permissions=await getUserPermissions(req.user.userId,req.user.role);
  if(!permissions.has('engineering.view'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: engineering.view'}});
  const [calculations,tests,tomb]=await Promise.all([
   pool.query(`SELECT c.* FROM engineering_calculations c WHERE ${visibilityReadSql({alias:'c',entityType:'engineering_calculation',userIdParameter:'$1',roleParameter:'$2'})} ORDER BY c.updated_at DESC,c.created_at DESC`,[req.user.userId,req.user.role]),
   pool.query(`SELECT t.* FROM engineering_tests t WHERE ${visibilityReadSql({alias:'t',entityType:'engineering_test',userIdParameter:'$1',roleParameter:'$2'})} ORDER BY t.updated_at DESC,t.created_at DESC`,[req.user.userId,req.user.role]),
   pool.query("SELECT entity_type,entity_id FROM sync_tombstones WHERE entity_type IN ('engineering_calculation','engineering_test') AND $1='admin' ORDER BY deleted_at DESC LIMIT 1000",[req.user.role])
  ]);
  const visibleProject=async(row)=>!row.project_id||(await getProjectAccess(row.project_id,req.user)).access!=='none';
  const calc=[];for(const row of calculations.rows)if(await visibleProject(row))calc.push(row);
  const tst=[];for(const row of tests.rows)if(await visibleProject(row))tst.push(row);
  const deleted_calculation_ids=tomb.rows.filter(r=>r.entity_type==='engineering_calculation').map(r=>r.entity_id);
  const deleted_test_ids=tomb.rows.filter(r=>r.entity_type==='engineering_test').map(r=>r.entity_id);
  res.setHeader('Cache-Control','no-store');res.json({calculations:calc,tests:tst,visible_calculation_ids:calc.map(row=>row.id),visible_test_ids:tst.map(row=>row.id),deleted_calculation_ids,deleted_test_ids});
 }catch(e){next(e);}
});
router.get('/projects/pull',async(req,res,next)=>{
  try{
    const permissions=await getUserPermissions(req.user.userId,req.user.role);
    if(!permissions.has('projects.view'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: projects.view'}});
    const projects=await pool.query(`SELECT p.* FROM projects p WHERE ${visibilityReadSql({alias:'p',entityType:'project',userIdParameter:'$1',roleParameter:'$2',projectIdExpression:'p.id'})} ORDER BY p.updated_at DESC`,[req.user.userId,req.user.role]);
    const ids=projects.rows.map(p=>p.id);
    const deletedRows=await pool.query("SELECT entity_type,entity_id FROM sync_tombstones WHERE entity_type IN ('project','project_task','project_experiment','project_bom','project_block','project_connector','project_experiment_measurement','project_experiment_observation','project_task_experiment','project_work_attachment','project_resource_requirement') AND (project_id=ANY($1::uuid[]) OR (project_id IS NULL AND entity_type='project')) ORDER BY deleted_at DESC LIMIT 2500",[ids]); const deletedByType={project:[],project_task:[],project_experiment:[],project_bom:[],project_block:[],project_connector:[],project_experiment_measurement:[],project_experiment_observation:[],project_task_experiment:[],project_work_attachment:[],project_resource_requirement:[]}; for(const row of deletedRows.rows)if(deletedByType[row.entity_type])deletedByType[row.entity_type].push(row.entity_id); if(!ids.length)return res.json({projects:[],visible_project_ids:[],deleted_project_ids:deletedByType.project,deleted_project_entities:deletedByType});
    const [tasks,experiments,bom,items,blocks,connectors,measurements,observations,taskExperiments,attachments,requirements,members,grants]=await Promise.all([
      pool.query('SELECT * FROM project_tasks WHERE project_id=ANY($1::uuid[]) ORDER BY created_at',[ids]),
      pool.query('SELECT * FROM project_experiments WHERE project_id=ANY($1::uuid[]) ORDER BY updated_at DESC',[ids]),
      pool.query('SELECT * FROM project_bom_items WHERE project_id=ANY($1::uuid[]) ORDER BY created_at',[ids]),
      pool.query('SELECT pi.project_id,pi.item_id,pi.allocated_quantity,pi.notes,i.name,i.type,i.status AS item_status,i.current_quantity,i.unit,i.sku FROM project_items pi JOIN items i ON i.id=pi.item_id WHERE pi.project_id=ANY($1::uuid[]) ORDER BY i.name',[ids]),
      pool.query('SELECT * FROM project_blocks WHERE project_id=ANY($1::uuid[]) ORDER BY created_at',[ids]),
      pool.query('SELECT * FROM project_connectors WHERE project_id=ANY($1::uuid[]) ORDER BY created_at',[ids]),
      pool.query('SELECT m.* FROM project_experiment_measurements m JOIN project_experiments e ON e.id=m.experiment_id WHERE e.project_id=ANY($1::uuid[]) ORDER BY m.created_at',[ids]),
      pool.query('SELECT o.* FROM project_experiment_observations o JOIN project_experiments e ON e.id=o.experiment_id WHERE e.project_id=ANY($1::uuid[]) ORDER BY o.created_at',[ids]),
      pool.query('SELECT te.* FROM project_task_experiments te WHERE te.project_id=ANY($1::uuid[]) ORDER BY te.created_at',[ids]),
      pool.query('SELECT a.* FROM project_work_attachments a LEFT JOIN project_tasks t ON t.id=a.task_id LEFT JOIN project_experiments e ON e.id=a.experiment_id WHERE COALESCE(t.project_id,e.project_id)=ANY($1::uuid[]) ORDER BY a.created_at',[ids]),
      pool.query('SELECT * FROM project_resource_requirements WHERE project_id=ANY($1::uuid[]) ORDER BY required_by NULLS LAST,created_at',[ids]),
      pool.query("SELECT pm.project_id,pm.user_id,pm.member_role,pm.joined_at,u.username,u.role FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=ANY($1::uuid[]) ORDER BY CASE pm.member_role WHEN 'lead' THEN 0 WHEN 'member' THEN 1 ELSE 2 END,u.username",[ids]),
      pool.query("SELECT entity_id,access_level FROM record_access_grants WHERE entity_type='project' AND entity_id=ANY($1::uuid[]) AND user_id=$2",[ids,req.user.userId])
    ]);
    const resourceAccess=new Map();
    for(const resourceId of new Set([...blocks.rows,...attachments.rows].map(row=>row.resource_id).filter(Boolean))){resourceAccess.set(resourceId,(await getResourceAccess(resourceId,req.user)).access!=='none');}
    const visibleBlocks=blocks.rows.filter(row=>!row.resource_id||resourceAccess.get(row.resource_id));
    const visibleBlockIds=new Set(visibleBlocks.map(row=>row.id));
    const visibleConnectors=connectors.rows.filter(row=>visibleBlockIds.has(row.source_block_id)&&visibleBlockIds.has(row.target_block_id));
    const visibleAttachments=attachments.rows.filter(row=>resourceAccess.get(row.resource_id));
    const by=(rows,key)=>{const m=new Map();for(const row of rows){const id=row[key];if(!m.has(id))m.set(id,[]);m.get(id).push(row);}return m;};
    const taskMap=by(tasks.rows,'project_id'),taskExperimentMap=by(taskExperiments.rows,'task_id'),taskExperimentProjectMap=by(taskExperiments.rows,'project_id'),experimentMap=by(experiments.rows,'project_id'),bomMap=by(bom.rows,'project_id'),itemMap=by(items.rows,'project_id'),blockMap=by(visibleBlocks,'project_id'),connectorMap=by(visibleConnectors,'project_id'),measurementMap=by(measurements.rows,'experiment_id'),observationMap=by(observations.rows,'experiment_id'),attachmentTaskMap=by(visibleAttachments,'task_id'),attachmentExperimentMap=by(visibleAttachments,'experiment_id'),requirementMap=by(requirements.rows,'project_id'),memberMap=by(members.rows,'project_id');
    const grantMap=new Map(grants.rows.map(row=>[row.entity_id,row.access_level]));
    for(const e of experiments.rows){e.measurements=measurementMap.get(e.id)||[];e.observations=observationMap.get(e.id)||[];e.attachments=attachmentExperimentMap.get(e.id)||[];}
    for(const t of tasks.rows){t.attachments=attachmentTaskMap.get(t.id)||[];t.experiments=taskExperimentMap.get(t.id)||[];}
    res.setHeader('Cache-Control','no-store');
    res.json({projects:projects.rows.map(p=>{const members=memberMap.get(p.id)||[];const memberRole=members.find(member=>member.user_id===req.user.userId)?.member_role||null;const access=effectiveProjectAccess({ownerId:p.owner_id,memberRole,visibility:p.visibility,grantLevel:grantMap.get(p.id)||null,userId:req.user.userId,role:req.user.role,canEdit:permissions.has('projects.edit')});return {...projectFinancialProjection(p,permissions),members,permissions:{access:access.access,member_role:access.memberRole,can_edit:access.access==='edit'||access.access==='admin',user_id:req.user.userId},tasks:taskMap.get(p.id)||[],experiments:experimentMap.get(p.id)||[],bom:bomMap.get(p.id)||[],items:itemMap.get(p.id)||[],blocks:blockMap.get(p.id)||[],connectors:connectorMap.get(p.id)||[],requirements:requirementMap.get(p.id)||[],task_experiments:taskExperimentProjectMap.get(p.id)||[]};}),visible_project_ids:ids,deleted_project_ids:deletedByType.project,deleted_project_entities:deletedByType});
  }catch(error){next(error);}
});
router.get('/pull',async(req,res,next)=>{try{const raw=typeof req.query.since==='string'?req.query.since.trim():'';let cursor=null;if(raw){cursor=decodePullCursor(raw);if(!cursor){const legacy=new Date(raw);if(Number.isNaN(legacy.getTime()))return res.status(400).json({error:{code:'INVALID_SYNC_CURSOR',message:'since must be a valid inventory sync cursor'}});cursor={at:legacy.toISOString(),type:'',id:''};}}const limit=Math.min(500,Math.max(1,Number(req.query.limit||500)));const values=cursor?[cursor.at,cursor.type,cursor.id,limit+1]:[limit+1];const where=cursor?`WHERE event_at > $1 OR (event_at = $1 AND (event_type > $2 OR (event_type = $2 AND event_id > $3)))`:'';const result=await pool.query(`SELECT event_type,event_id,event_at,to_char(event_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,item,deleted FROM (SELECT 'item'::text AS event_type,id::text AS event_id,updated_at AS event_at,to_jsonb(items) AS item,false AS deleted FROM items UNION ALL SELECT 'delete'::text AS event_type,entity_id::text AS event_id,deleted_at AS event_at,NULL::jsonb AS item,true AS deleted FROM sync_tombstones WHERE entity_type='item') events ${where} ORDER BY event_at ASC,event_type ASC,event_id ASC LIMIT $${values.length}`,values);const rows=result.rows;const hasMore=rows.length>limit;const page=hasMore?rows.slice(0,limit):rows;const last=page[page.length-1];const nextCursor=last?encodePullCursor(last.cursor_at,last.event_type,last.event_id):(cursor?raw:null);res.setHeader('Cache-Control','no-store');res.json({items:page.filter(row=>!row.deleted).map(row=>row.item),deleted_item_ids:page.filter(row=>row.deleted).map(row=>row.event_id),next_cursor:nextCursor,has_more:hasMore,snapshot_complete:!raw&&!hasMore});}catch(error){next(error);}});
router.post('/push',async(req,res,next)=>{const body=object(req.body,'Sync request');const deviceId=typeof body.device_id==='string'&&body.device_id.trim()?body.device_id.trim():null;const changes=Array.isArray(body.changes)?body.changes:null;if(!deviceId)return res.status(400).json({error:{code:'DEVICE_ID_REQUIRED',message:'device_id is required'}});if(!changes)return res.status(400).json({error:{code:'CHANGES_REQUIRED',message:'changes must be an array'}});if(changes.length>100)return res.status(413).json({error:{code:'SYNC_BATCH_TOO_LARGE',message:'A maximum of 100 changes can be synchronized per request'}});try{const permissions=await getUserPermissions(req.user.userId,req.user.role);const results=[];for(const raw of changes){const change=object(raw,'Sync change');if(typeof change.change_id!=='string'||!change.change_id.trim()){results.push({change_id:null,status:'rejected',error:{code:'CHANGE_ID_REQUIRED',message:'change_id is required'}});continue;}const entityType=String(change.entity_type||''),operation=String(change.operation||'');const required=entityType==='item'?(operation==='import'?null:operation==='create'?'inventory.create':['delete','bulk_delete'].includes(operation)?'inventory.delete':'inventory.edit'):['daily_preferences','notification_read'].includes(entityType)?null:entityType==='project_comment'?'projects.edit':entityType==='maintenance_record'?'inventory.edit':entityType==='note'?(operation==='create'?'notes.create':operation==='delete'?'notes.delete':'notes.edit'):knowledgeEntityType(entityType)?'projects.edit':entityType==='project_item'?'projects.edit':engineeringEntityType(entityType)?(operation==='create'?'engineering.create':operation==='delete'?'engineering.delete':'engineering.edit'):entityType==='item_movement'?'inventory.adjust_stock':['resource_download_job','media_download_settings'].includes(entityType)?'resources.edit':entityType==='resource'?(['create','create_copy'].includes(operation)?'resources.create':operation==='delete'?'resources.delete':'resources.edit'):['location','supplier','storage_container'].includes(entityType)?(operation==='create'?'inventory.create':operation==='delete'?'inventory.delete':'inventory.edit'):projectEntityType(entityType)?(operation==='create'?'projects.create':operation==='delete'?'projects.delete':'projects.edit'):FINANCE_CONFIG[entityType]?(operation==='create'?(entityType==='transaction'?(change.payload?.transaction?.direction||change.payload?.record?.direction||change.payload?.direction)==='income'?'finance.create_income':'finance.create_expense':'finance.edit'):operation==='delete'?'finance.delete':'finance.edit'):operation==='bulk_delete'?'inventory.delete':operation==='bulk_status'?'inventory.edit':'inventory.edit';if(required&&!permissions.has(required)){results.push({change_id:change.change_id,status:'rejected',error:{code:'PERMISSION_DENIED',message:`Permission required: ${required}`}});continue;}change.__role=req.user.role;change.__device_id=deviceId;const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+change.change_id]);if(['supplier','storage_container'].includes(entityType)){change.entity_id=catalogUuid(change.entity_id);await authorizeCatalog(entityType,operation,req.user);}if(entityType==='item'&&operation==='import')await authorizeInventoryImport(change.payload,req.user);if(entityType==='project_comment'){change.entity_id=catalogUuid(change.entity_id);await authorizeComment(catalogUuid(change.payload?.record?.project_id),req.user,true);}if(entityType==='resource_download_job')await authorizeDownloadControl(change.payload?.resource_id||change.payload?.resourceId,req.user);const prior=await client.query('SELECT payload_json,response_json,user_id,device_id,entity_type,entity_id,operation FROM sync_idempotency WHERE change_id=$1 FOR UPDATE',[change.change_id]);if(prior.rowCount){if(String(prior.rows[0].user_id)!==String(req.user.userId)||prior.rows[0].device_id!==deviceId||prior.rows[0].entity_type!==entityType||prior.rows[0].operation!==operation||String(prior.rows[0].entity_id||'')!==String(change.entity_id||'')){await client.query('ROLLBACK');results.push({change_id:change.change_id,status:'rejected',error:{code:'IDEMPOTENCY_OWNERSHIP_MISMATCH',message:'change_id belongs to a different user, device or operation'}});continue;}const same=(await client.query('SELECT $1::jsonb = $2::jsonb AS same',[prior.rows[0].payload_json,change.payload])).rows[0].same;if(!same){await client.query('ROLLBACK');results.push({change_id:change.change_id,status:'rejected',error:{code:'IDEMPOTENCY_PAYLOAD_MISMATCH',message:'change_id was already used with a different payload'}});continue;}await client.query('COMMIT');results.push({change_id:change.change_id,status:'synced',result:syncResponseProjection(entityType,prior.rows[0].response_json,permissions)});continue;}const result=await applyChange(client,change,req.user.userId);await client.query('INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,200)',[change.change_id,deviceId,req.user.userId,entityType,change.entity_id||null,operation,change.payload,result]);await client.query('COMMIT');
      if(!(entityType==='resource'&&(operation==='edit_metadata'||['create','create_copy','edit_content'].includes(operation)&&change.payload?.resource?.kind==='file'))&&!['item','item_movement','maintenance_record','daily_preferences','supplier','storage_container','notification_read','project_comment'].includes(entityType))await writeAuditLog({req,actorUserId:req.user.userId,action:`sync:${operation}`,entityType,entityId:typeof change.entity_id==='string'&&/^[0-9a-f-]{32,36}$/i.test(change.entity_id)?change.entity_id:null,newValue:result,deviceId,metadata:{sync_mode:'online',authorization:'server',sync_entity_id:change.entity_id||null}});
      results.push({change_id:change.change_id,status:'synced',result:syncResponseProjection(entityType,result,permissions)});}catch(error){await client.query('ROLLBACK').catch(()=>{});if(error?.code==='23505'){const prior=await pool.query('SELECT payload_json,response_json,user_id,device_id,entity_type,operation FROM sync_idempotency WHERE change_id=$1',[change.change_id]);if(prior.rowCount){if(String(prior.rows[0].user_id)!==String(req.user.userId)||prior.rows[0].device_id!==deviceId||prior.rows[0].entity_type!==entityType||prior.rows[0].operation!==operation){results.push({change_id:change.change_id,status:'rejected',error:{code:'IDEMPOTENCY_OWNERSHIP_MISMATCH',message:'change_id belongs to a different user, device or operation'}});continue;}const same=(await pool.query('SELECT $1::jsonb = $2::jsonb AS same',[prior.rows[0].payload_json,change.payload])).rows[0].same;if(same){results.push({change_id:change.change_id,status:'synced',result:syncResponseProjection(entityType,prior.rows[0].response_json,permissions)});continue;}}}const status=Number(error?.status)>=400&&Number(error?.status)<500?'rejected':'failed';results.push({change_id:change.change_id,status,error:{code:error?.code||'SYNC_APPLY_FAILED',message:error?.message||'Unable to apply sync change'}});}finally{client.release();}}res.json({device_id:deviceId,accepted:results.filter(r=>r.status==='synced').length,results});}catch(error){next(error);}});

const NOTE_FIELDS=['title','body','tags','item_id','project_id','visibility'];

async function canEditSyncedNote(note,user){
  if(note.visibility==='restricted'&&!(await canEditRestrictedEntity({entityType:'note',entityId:note.id,user})))return false;
  if(!note.project_id)return true;
  const access=await getProjectAccess(note.project_id,user);
  return access.access==='edit'||access.access==='admin';
}

async function applyNoteEntity(client,change,user){
  const payload=object(change.payload,'Note sync payload');
  const record=payload.note||payload.record||payload;
  const entityId=id(record.id||payload.id||change.entity_id,'Note ID');
  const required=change.operation==='create'?'notes.create':change.operation==='delete'?'notes.delete':'notes.edit';
  const permissions=await getUserPermissions(user.userId,user.role);
  if(!permissions.has(required))fail(403,'PERMISSION_DENIED',`Permission required: ${required}`);
  const existing=await client.query('SELECT * FROM notes WHERE id=$1 FOR UPDATE',[entityId]);

  if(change.operation==='create'){
    if(existing.rowCount){
      if(!(await canEditSyncedNote(existing.rows[0],user)))fail(403,'NOTE_EDIT_DENIED','You do not have edit access to this note');
      return existing.rows[0];
    }
    if(!String(record.title||'').trim())fail(400,'INVALID_NOTE','Note title is required');
    const visibility=record.visibility??'lab';
    if(!isVisibility(visibility))fail(400,'INVALID_NOTE_VISIBILITY','visibility must be lab, project, or restricted');
    if(visibility==='project'&&!record.project_id)fail(400,'INVALID_NOTE_VISIBILITY','project visibility requires project_id');
    if(record.project_id){
      const access=await getProjectAccess(record.project_id,user);
      if(access.access!=='edit'&&access.access!=='admin')fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');
    }
    const values=[entityId],columns=['id'];
    for(const field of NOTE_FIELDS){
      if(Object.prototype.hasOwnProperty.call(record,field)){
        columns.push(field);
        values.push(field==='title'?String(record[field]??'').trim():record[field]??null);
      }
    }
    columns.push('author_id');
    values.push(user.userId);
    const placeholders=values.map((_,i)=>'$'+(i+1)).join(',');
    const created=(await client.query('INSERT INTO notes ('+columns.join(',')+') VALUES ('+placeholders+') RETURNING *',values)).rows[0];
    if(visibility==='restricted')await client.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('note',$1,$2,'edit',$2) ON CONFLICT(entity_type,entity_id,user_id) DO UPDATE SET access_level='edit'",[entityId,user.userId]);
    return created;
  }

  if(!existing.rowCount&&change.operation==='delete')return{deleted:true,id:entityId,already_deleted:true};
  if(!existing.rowCount)fail(409,'NOTE_NOT_FOUND',`Note ${entityId} does not exist on the server`);
  if(change.operation==='delete'){
    if(!(await canEditSyncedNote(existing.rows[0],user)))fail(403,'NOTE_EDIT_DENIED','You do not have edit access to this note');
    await client.query("DELETE FROM record_access_grants WHERE entity_type='note' AND entity_id=$1",[entityId]);
    await client.query('DELETE FROM notes WHERE id=$1',[entityId]);
    await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES('note',$1,$2) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[entityId,existing.rows[0].project_id||null]);
    return{deleted:true,id:entityId};
  }

  const current=existing.rows[0];
  if(!(await canEditSyncedNote(current,user)))fail(403,'NOTE_EDIT_DENIED','You do not have edit access to this note');
  const destinationProject=Object.prototype.hasOwnProperty.call(record,'project_id')?record.project_id:current.project_id;
  if(destinationProject){
    const destinationAccess=await getProjectAccess(destinationProject,user);
    if(destinationAccess.access!=='edit'&&destinationAccess.access!=='admin')fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');
  }
  const nextVisibility=Object.prototype.hasOwnProperty.call(record,'visibility')?record.visibility:current.visibility;
  if(!isVisibility(nextVisibility))fail(400,'INVALID_NOTE_VISIBILITY','visibility must be lab, project, or restricted');
  if(nextVisibility==='project'&&!destinationProject)fail(400,'INVALID_NOTE_VISIBILITY','project visibility requires project_id');

  const updates=[],values=[];
  for(const field of NOTE_FIELDS){
    if(Object.prototype.hasOwnProperty.call(record,field)){
      values.push(field==='title'?String(record[field]??'').trim():record[field]??null);
      updates.push(field+'=$'+values.length);
    }
  }
  if(!updates.length)return current;
  if(updates.some(x=>x.startsWith('title='))&&!String(record.title||'').trim())fail(400,'INVALID_NOTE','Note title is required');
  await client.query('INSERT INTO note_revisions(note_id,title,body,tags,edited_by) VALUES($1,$2,$3,$4,$5)',[entityId,current.title,current.body,current.tags||[],user.userId]);
  values.push(entityId);
  const updated=(await client.query('UPDATE notes SET '+updates.join(',')+',updated_at=now() WHERE id=$'+values.length+' RETURNING *',values)).rows[0];
  if(current.visibility!==nextVisibility&&nextVisibility==='restricted')await client.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('note',$1,$2,'edit',$2) ON CONFLICT(entity_type,entity_id,user_id) DO UPDATE SET access_level='edit'",[entityId,user.userId]);
  if(current.visibility==='restricted'&&nextVisibility!=='restricted')await client.query("DELETE FROM record_access_grants WHERE entity_type='note' AND entity_id=$1",[entityId]);
  return updated;
}

const KNOWLEDGE_CONFIG={
  finding:{table:'lab_findings',fields:['project_id','experiment_id','title','body','status','confidence','tags','visibility']},
  knowledge_result:{table:'lab_results',fields:['project_id','experiment_id','finding_id','title','summary','value_numeric','value_text','unit','visibility']},
  knowledge_relationship:{table:'knowledge_relationships',fields:['project_id','source_type','source_id','target_type','target_id','relationship']}
};
function knowledgeEntityType(value){return Object.prototype.hasOwnProperty.call(KNOWLEDGE_CONFIG,value);}

async function applyKnowledgeEntity(client,change,user){
  const cfg=KNOWLEDGE_CONFIG[change.entity_type];
  if(!cfg)fail(400,'UNSUPPORTED_KNOWLEDGE_ENTITY','Unsupported knowledge entity');
  const payload=object(change.payload,'Knowledge sync payload');
  const record=payload.record||payload.finding||payload.result||payload.relationship||payload;
  const entityId=id(record.id||payload.id||change.entity_id,'Knowledge entity ID');
  const existing=await client.query('SELECT * FROM '+cfg.table+' WHERE id=$1 FOR UPDATE',[entityId]);

  if(change.operation==='create'){
    if(record.project_id&&!(await canEditProject(client,record.project_id,user)))fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');
    if(existing.rowCount)fail(409,'KNOWLEDGE_ID_COLLISION','Knowledge entity ID already exists');
    if(change.entity_type==='knowledge_relationship'){
      if(!(await canReadRelationshipEndpoint(record.source_type,record.source_id,user,client))||
         !(await canReadRelationshipEndpoint(record.target_type,record.target_id,user,client)))
        fail(403,'RELATIONSHIP_ENDPOINT_DENIED','Relationship endpoint access denied');
      const values=[entityId],columns=['id'];
      for(const field of cfg.fields)if(Object.prototype.hasOwnProperty.call(record,field)){columns.push(field);values.push(record[field]??null);}
      columns.push('created_by');values.push(user.userId);
      const placeholders=values.map((_,i)=>'$'+(i+1)).join(',');
      return(await client.query('INSERT INTO '+cfg.table+' ('+columns.join(',')+') VALUES ('+placeholders+') RETURNING *',values)).rows[0];
    }
    const visibility=record.visibility??'lab';
    if(!isVisibility(visibility)||visibility==='project'&&!record.project_id)fail(400,'INVALID_KNOWLEDGE_VISIBILITY','Invalid knowledge visibility or missing project');
    if(!String(record.title||'').trim())fail(400,'INVALID_KNOWLEDGE_RECORD','title is required');
    const values=[entityId],columns=['id'];
    for(const field of cfg.fields)if(Object.prototype.hasOwnProperty.call(record,field)){columns.push(field);values.push(field==='title'?String(record[field]??'').trim():record[field]??null);}
    columns.push('created_by','updated_by');values.push(user.userId,user.userId);
    const placeholders=values.map((_,i)=>'$'+(i+1)).join(',');
    const created=(await client.query('INSERT INTO '+cfg.table+' ('+columns.join(',')+') VALUES ('+placeholders+') RETURNING *',values)).rows[0];
    if(visibility==='restricted')await client.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES($1,$2,$3,'edit',$3) ON CONFLICT(entity_type,entity_id,user_id) DO UPDATE SET access_level='edit'",[change.entity_type==='finding'?'finding':'result',entityId,user.userId]);
    return created;
  }

  if(!existing.rowCount&&change.operation==='delete')return{deleted:true,id:entityId,already_deleted:true};
  if(!existing.rowCount)fail(409,'KNOWLEDGE_ENTITY_NOT_FOUND',change.entity_type+' '+entityId+' does not exist on the server');
  const current=existing.rows[0];
  if(current.project_id&&!(await canEditProject(client,current.project_id,user)))fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');
  if(change.entity_type==='knowledge_relationship'&&!(await canReadKnowledgeRelationship(current,user,client)))fail(403,'RELATIONSHIP_ENDPOINT_DENIED','Relationship endpoint access denied');
  const visibilityEntity={finding:'finding',knowledge_result:'result'}[change.entity_type];
  if(visibilityEntity&&current.visibility==='restricted'&&!(await canEditRestrictedEntity({entityType:visibilityEntity,entityId,user})))fail(403,'RECORD_ACCESS_DENIED','You do not have edit access to this knowledge record');

  if(change.operation==='delete'){
    await client.query('DELETE FROM '+cfg.table+' WHERE id=$1',[entityId]);
    await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES($1,$2,$3) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[change.entity_type,entityId,existing.rows[0]?.project_id||null]);
    return{deleted:true,id:entityId};
  }

  if(change.entity_type==='knowledge_relationship')fail(400,'UNSUPPORTED_KNOWLEDGE_OPERATION','Knowledge relationships support create and delete only');
  if(record.visibility!==undefined&&record.visibility!==current.visibility)fail(400,'VISIBILITY_CHANGE_UNSUPPORTED','Knowledge visibility changes require grant administration');

  const updates=[],values=[];
  for(const field of cfg.fields){
    if(['project_id','visibility'].includes(field))continue;
    if(Object.prototype.hasOwnProperty.call(record,field)){
      values.push(field==='title'?String(record[field]??'').trim():record[field]??null);
      updates.push(field+'=$'+values.length);
    }
  }
  if(!updates.length)return existing.rows[0];
  if(updates.some(x=>x.startsWith('title='))&&!String(record.title||'').trim())fail(400,'INVALID_KNOWLEDGE_RECORD','title is required');
  values.push(user.userId,entityId);
  return(await client.query('UPDATE '+cfg.table+' SET '+updates.join(',')+',updated_by=$'+(values.length-1)+' WHERE id=$'+values.length+' RETURNING *',values)).rows[0];
}


async function applyChange(client,change,userId){if(change.entity_type==='media_download_settings')return applyDownloadSettings(client,change,{userId,role:change.__role});if(change.entity_type==='project_comment')return applyCommentChange(client,change,{userId,role:change.__role});if(change.entity_type==='notification_read')return applyNotificationRead(client,change,{userId,role:change.__role});if(['supplier','storage_container'].includes(change.entity_type))return applyCatalogChange(client,change,{userId,role:change.__role});if(change.entity_type==='daily_preferences')return applyDailyPreferenceChange(client,change,{userId,role:change.__role});if(change.entity_type==='maintenance_record')return applyMaintenanceChange(client,change,{userId,role:change.__role});if(change.entity_type==='resource_download_job')return applyResourceDownloadJobEntity(client,change,{userId,role:change.__role});if(change.entity_type==='note')return applyNoteEntity(client,change,{userId,role:change.__role});if(change.entity_type==='project_item')return applyProjectItemEntity(client,change,{userId,role:change.__role});if(change.entity_type==='project_task_experiment')return applyProjectTaskExperimentEntity(client,change,{userId,role:change.__role});if(knowledgeEntityType(change.entity_type))return applyKnowledgeEntity(client,change,{userId,role:change.__role});if(change.entity_type==='location')return applyLocationEntity(client,change,{userId,role:change.__role});if(engineeringEntityType(change.entity_type))return applyEngineeringEntity(client,change,{userId,role:change.__role});if(projectEntityType(change.entity_type))return applyProjectEntity(client,change,{userId,role:change.__role});if(change.entity_type==='resource')return applyResourceEntity(client,change,{userId,role:change.__role});if(FINANCE_CONFIG[change.entity_type])return applyFinanceEntity(client,change,{userId,role:change.__role});if(['item','item_movement'].includes(change.entity_type))return applyInventoryMutation(client,change,{userId,role:change.__role},()=>applyInventoryRaw(client,change,userId));fail(400,'UNSUPPORTED_SYNC_CHANGE','Unsupported sync entity');}

export default router;
import { linkedProjectReadSql } from '../middleware/visibility.js';
