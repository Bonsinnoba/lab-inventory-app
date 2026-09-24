import { Router } from 'express';
import { randomUUID } from 'crypto';
import { pool } from '../db.js';
import { getUserPermissions } from '../middleware/permissions.js';
import { writeAuditLog } from '../middleware/audit.js';
import { getResourceAccess, requireResourceEditor, validateResourceParent } from '../middleware/resource-access.js';
import { getProjectAccess } from '../middleware/project-access.js';
const router=Router();
function generateItemSku(name, type) {
  const namePart = String(name || 'item').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 8) || 'ITEM';
  const typePart = String(type || 'item').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 6) || 'ITEM';
  return `LAB-${namePart}-${typePart}-${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

const ITEM_FIELDS=['name','type','category','sku','initial_quantity','current_quantity','unit','dimensions','status','condition_notes','unit_cost','replacement_cost','location_id','storage_location','photo_url','supplier','supplier_id','part_number','next_maintenance_date','maintenance_interval_days','manufacturer','model_number','serial_number','asset_tag','calibration_interval_days','next_calibration_date','assigned_to','image_resource_id','created_at','updated_at'];
const MOVEMENT_TYPES=new Set(['receive','checkout','return','consume','adjust','transfer','damage','loss','repair_out','repair_in']); const INCOMING=new Set(['receive','return','repair_in']); const OUTGOING=new Set(['checkout','consume','damage','loss','repair_out']);
function fail(status,code,message){const e=new Error(message);e.status=status;e.code=code;throw e;} function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'INVALID_SYNC_PAYLOAD',`${label} must be an object`);return value;} function resourceLinkLockKey(record){ return ['link',String(record.url||'').trim().replace(/\/+$/,'').toLowerCase(),record.item_id||'',record.project_id||'',record.note_id||'',record.parent_resource_id||''].join('|'); } async function lockResourceLink(client,record){ await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[resourceLinkLockKey(record)]); } function number(value,label){const n=Number(value);if(!Number.isFinite(n))fail(400,'INVALID_SYNC_PAYLOAD',`${label} must be numeric`);return n;} function id(value,label){if(typeof value!=='string'||!/^[0-9a-f-]{32,36}$/i.test(value))fail(400,'INVALID_SYNC_ID',`${label} is invalid`);return value;}
function encodePullCursor(eventAt,eventType,eventId){const raw=JSON.stringify({at:new Date(eventAt).toISOString(),type:eventType,id:eventId});return Buffer.from(raw,'utf8').toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decodePullCursor(value){if(!value)return null;try{const padded=value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'=');const parsed=JSON.parse(Buffer.from(padded,'base64').toString('utf8'));if(!parsed||typeof parsed.at!=='string'||!parsed.type||typeof parsed.id!=='string')return null;const at=new Date(parsed.at);if(Number.isNaN(at.getTime()))return null;if(parsed.type!=='item'&&parsed.type!=='delete')return null;return{at:at.toISOString(),type:parsed.type,id:parsed.id};}catch{return null;}}

const PROJECT_ENTITY_CONFIG = {
  project: { table: 'projects', fields: ['name','status','budget','description','priority','start_date','due_date','owner_id'] },
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
  engineering_calculation:{table:'engineering_calculations',fields:['project_id','experiment_id','title','category','formula','inputs','result_numeric','result_text','result_unit','created_by'],permission:{create:'engineering.create',update:'engineering.edit',delete:'engineering.delete'}},
  engineering_test:{table:'engineering_tests',fields:['project_id','title','test_type','description','status','inputs','results','conclusion','performed_by'],permission:{create:'engineering.create',update:'engineering.edit',delete:'engineering.delete'}}
};
function projectEntityType(value){return Object.prototype.hasOwnProperty.call(PROJECT_ENTITY_CONFIG,value);}
function engineeringEntityType(value){return Object.prototype.hasOwnProperty.call(ENGINEERING_CONFIG,value);}
async function canEditProject(client,projectId,user){
  if(!projectId)return false;
  if(user?.role==='admin')return true;
  const result=await client.query('SELECT 1 FROM projects p WHERE p.id=$1 AND (p.owner_id=$2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$2 AND pm.member_role IN (\'lead\',\'member\')))',[projectId,user?.userId]);
  return result.rowCount>0;
}
function validateProjectRecord(entityType,record){
  if(entityType==='project'){
    if(!String(record.name||'').trim())fail(400,'INVALID_PROJECT','Project name is required');
    if(!['active','completed','on_hold','cancelled'].includes(record.status||'active'))fail(400,'INVALID_PROJECT','Invalid project status');
    if(!['low','normal','high','critical'].includes(record.priority||'normal'))fail(400,'INVALID_PROJECT','Invalid project priority');
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
  validateProjectRecord(entityType,record);
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
    return(await client.query('INSERT INTO '+cfg.table+' ('+columns.join(',')+') VALUES ('+placeholders+') RETURNING *',values)).rows[0];
  }
  if(change.operation==='update'){
    const updates=[],values=[];
    for(const field of cfg.fields){
      if(['project_id','created_by','owner_id'].includes(field))continue;
      if(Object.prototype.hasOwnProperty.call(record,field)){values.push(record[field]??null);updates.push(field+'=$'+values.length);}
    }
    if(!updates.length)return existing;
    updates.push('updated_at=now()');values.push(entityId);
    return(await client.query('UPDATE '+cfg.table+' SET '+updates.join(',')+' WHERE id=$'+values.length+' RETURNING *',values)).rows[0];
  }
  if(change.operation==='delete'){
    const result=await client.query('DELETE FROM '+cfg.table+' WHERE id=$1 RETURNING id',[entityId]);
    if(result.rowCount)await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES($1,$2,$3) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[entityType,entityId,projectId]);
    return{deleted:Boolean(result.rowCount),id:entityId};
  }
  fail(400,'UNSUPPORTED_PROJECT_OPERATION','Unsupported project operation: '+change.operation);
}

async function applyItem(client,change){const payload=object(change.payload,'Item payload'),itemId=id(payload.id||change.entity_id,'Item ID');if(change.operation==='create'){const values=[itemId],columns=['id'];for(const field of ITEM_FIELDS)if(Object.prototype.hasOwnProperty.call(payload,field)){columns.push(field);const value=field==='sku' ? (typeof payload[field]==='string'&&payload[field].trim() ? payload[field].trim() : generateItemSku(payload.name,payload.type)) : payload[field];values.push(value??null);}if((await client.query('SELECT id FROM items WHERE id=$1',[itemId])).rowCount)fail(409,'ITEM_ALREADY_EXISTS',`Item ${itemId} already exists`);return(await client.query(`INSERT INTO items (${columns.join(',')}) VALUES (${values.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,values)).rows[0];}if(change.operation==='update'){const patch=object(payload.patch||payload.item||payload,'Item update'),updates=[],values=[];const before=await client.query('SELECT * FROM items WHERE id=$1 FOR UPDATE',[itemId]);if(!before.rowCount)fail(409,'ITEM_NOT_FOUND',`Item ${itemId} does not exist on the server`);const base=payload.base_updated_at;if(base&&!payload.conflict_resolution){const serverAt=new Date(before.rows[0].updated_at),baseAt=new Date(base);if(Number.isNaN(baseAt.getTime())||Number.isNaN(serverAt.getTime())||serverAt.getTime()!==baseAt.getTime())fail(409,'SYNC_CONFLICT',`Item ${itemId} changed on the server after this offline edit`);}if(payload.conflict_resolution&&payload.conflict_resolution!=='keep_local')fail(400,'INVALID_CONFLICT_RESOLUTION','Unsupported conflict resolution');for(const field of ITEM_FIELDS)if(field!=='id'&&field!=='created_at'&&field!=='updated_at'&&Object.prototype.hasOwnProperty.call(patch,field)){values.push(patch[field]??null);updates.push(`${field}=$${values.length}`);}if(!updates.length)return before.rows[0];updates.push('updated_at=now()');values.push(itemId);return(await client.query(`UPDATE items SET ${updates.join(',')} WHERE id=$${values.length} RETURNING *`,values)).rows[0];}if(change.operation==='delete'){const result=await client.query('DELETE FROM items WHERE id=$1 RETURNING id',[itemId]);if(result.rowCount)await client.query("INSERT INTO sync_tombstones(entity_type,entity_id) VALUES('item',$1) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now()",[itemId]);return{deleted:Boolean(result.rowCount),id:itemId};}fail(400,'UNSUPPORTED_ITEM_OPERATION',`Unsupported item operation: ${change.operation}`);}
const RESOURCE_FIELDS=['name','kind','file_type','original_filename','mime_type','size_bytes','parent_resource_id','relative_path','url','thumbnail_url','item_id','project_id','note_id','category','description','tags'];
async function applyResourceEntity(client,change,user){
 const payload=object(change.payload,'Resource sync payload'),record=payload.resource||payload.record||payload,entityId=id(record.id||payload.id||change.entity_id,'Resource ID');
 if(change.operation==='create'){
  const permissions=await getUserPermissions(user.userId,user.role);
  if(!permissions.has('resources.create'))fail(403,'PERMISSION_DENIED','Permission required: resources.create');
  if(!['link','folder'].includes(String(record.kind||'')))fail(400,'UNSUPPORTED_RESOURCE_CREATE','Only link and folder resources can be created through offline sync');
  if(!String(record.name||'').trim())fail(400,'INVALID_RESOURCE','Resource name is required');
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
  if(record.kind==='link'&&record.url){ await lockResourceLink(client,record); const duplicate=await client.query("SELECT * FROM resources WHERE kind='link' AND lower(btrim(url))=lower($1) AND item_id IS NOT DISTINCT FROM $2 AND project_id IS NOT DISTINCT FROM $3 AND note_id IS NOT DISTINCT FROM $4 AND parent_resource_id IS NOT DISTINCT FROM $5 ORDER BY (local_media_path IS NOT NULL) DESC, created_at ASC LIMIT 1",[String(record.url).trim().replace(/\/+$/,''),record.item_id||null,record.project_id||null,record.note_id||null,record.parent_resource_id||null]); if(duplicate.rowCount)return duplicate.rows[0]; }
  const existing=await client.query('SELECT * FROM resources WHERE id=$1',[entityId]);
  if(existing.rowCount)return existing.rows[0];
  const values=[entityId],columns=['id'];
  for(const field of RESOURCE_FIELDS){
   if(field==='file_type'&&record.kind==='folder'&&!record.file_type){columns.push(field);values.push('schematic_folder');continue;}
   if(Object.prototype.hasOwnProperty.call(record,field)){
    const value=field==='url'&&record.url!=null ? String(record.url).trim().replace(/\/+$/,'') : record[field];
    columns.push(field);values.push(value??null);
   }
  }
  columns.push('uploaded_by');values.push(user.userId);
  const placeholders=values.map((_,i)=>'$'+(i+1)).join(',');
  return (await client.query('INSERT INTO resources ('+columns.join(',')+') VALUES ('+placeholders+') RETURNING *',values)).rows[0];
 }
 const existing=await client.query('SELECT * FROM resources WHERE id=$1 FOR UPDATE',[entityId]);
 if(!existing.rowCount&&change.operation==='delete')return{id:entityId,deleted:true,already_deleted:true};
 if(!existing.rowCount)fail(409,'RESOURCE_NOT_FOUND',`Resource ${entityId} does not exist on the server`);
 const access=await requireResourceEditor(entityId,{userId:user.userId,role:user.role});
 if(!access.ok)fail(access.status,access.error.code,access.error.message);
 if(change.operation==='update'){
  const updates=[],values=[];
  for(const field of ['category','description','tags'])if(Object.prototype.hasOwnProperty.call(record,field)){values.push(record[field]??null);updates.push(field+'=$'+values.length);}
  if(!updates.length)return existing.rows[0];
  values.push(entityId);
  return (await client.query('UPDATE resources SET '+updates.join(',')+' WHERE id=$'+values.length+' RETURNING *',values)).rows[0];
 }
 if(change.operation==='delete'){
  const projectId=existing.rows[0]?.project_id||null,itemId=existing.rows[0]?.item_id||null,noteId=existing.rows[0]?.note_id||null;
  await client.query('DELETE FROM resources WHERE id=$1',[entityId]);
  await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id,item_id,note_id) VALUES('resource',$1,$2,$3,$4) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id,item_id=EXCLUDED.item_id,note_id=EXCLUDED.note_id",[entityId,projectId,itemId,noteId]);
  return{id:entityId,deleted:true};
 }
 fail(400,'UNSUPPORTED_RESOURCE_OPERATION','Unsupported resource operation: '+change.operation);
}

async function applyResourceDownloadJobEntity(client,change,user){
 if(change.operation!=='create')fail(400,'UNSUPPORTED_SYNC_OPERATION','Download queue requests support create only');
 const payload=object(change.payload,'Download queue payload');
 const resourceId=id(payload.resource_id||payload.resourceId,'Resource ID');
 const jobId=id(change.entity_id,'Download job ID');
 const permissions=await getUserPermissions(user.userId,user.role);
 if(!permissions.has('resources.edit'))fail(403,'PERMISSION_DENIED','Permission required: resources.edit');
 const access=await requireResourceEditor(resourceId,user);
 if(!access.ok)fail(access.status,access.error?.code||'RESOURCE_ACCESS_DENIED',access.error?.message||'You do not have edit access to this resource');
 const resource=await client.query('SELECT * FROM resources WHERE id=$1',[resourceId]);
 if(!resource.rowCount)fail(404,'RESOURCE_NOT_FOUND','Resource not found');
 if(resource.rows[0].kind!=='link'||!resource.rows[0].url)fail(400,'INVALID_DOWNLOAD_RESOURCE','Only URL resources can be downloaded');
 if(resource.rows[0].local_media_path)fail(409,'MEDIA_ALREADY_DOWNLOADED','This resource already has a local video copy');
 const existing=await client.query("SELECT * FROM resource_download_jobs WHERE resource_id=$1 AND status IN ('queued','scheduled','downloading','paused') LIMIT 1",[resourceId]);
 if(existing.rowCount)return existing.rows[0];
 const settings=await client.query('SELECT default_quality,max_retries FROM media_download_settings WHERE id=1');
 const quality=['best','1080p','720p','480p'].includes(payload.quality)?payload.quality:settings.rows[0]?.default_quality||'720p';
 const maxAttempts=1+Math.max(0,Math.min(4,Number(settings.rows[0]?.max_retries)||0));
 const inserted=await client.query("INSERT INTO resource_download_jobs(id,resource_id,requested_by,status,quality,scheduled_for,priority,max_attempts) VALUES($1,$2,$3,'queued',$4,NULL,0,$5) RETURNING *",[jobId,resourceId,user.userId,quality,maxAttempts]);
 return inserted.rows[0];
}
const FINANCE_CONFIG={transaction:{table:'transactions',permission:{create:'finance.create_expense',update:'finance.edit',delete:'finance.delete'}},budget_period:{table:'budget_periods',permission:{create:'finance.edit',update:'finance.edit',delete:'finance.delete'}},funding_source:{table:'funding_sources',permission:{create:'finance.edit',update:'finance.edit',delete:'finance.delete'}}};async function applyFinanceEntity(client,change,user){const cfg=FINANCE_CONFIG[change.entity_type],required=cfg?.permission?.[change.operation];if(required){const permissions=await getUserPermissions(user.userId,user.role);if(!permissions.has(required))fail(403,'PERMISSION_DENIED',`Permission required: ${required}`);}const payload=object(change.payload,'Finance sync payload'),record=payload.transaction||payload.budget_period||payload.funding_source||payload.record||payload,entityId=id(record.id||payload.id||change.entity_id,'Finance ID');const existing=await client.query(`SELECT * FROM ${cfg.table} WHERE id=$1`,[entityId]);if(change.operation==='create'){if(existing.rowCount)return existing.rows[0];}else if(!existing.rowCount&&change.operation==='delete')return{id:entityId,deleted:true,already_deleted:true};else if(!existing.rowCount)fail(409,'FINANCE_NOT_FOUND',`Finance record ${entityId} does not exist`);if(cfg.table==='transactions'){
  const permissions=await getUserPermissions(user.userId,user.role);
  const previous=existing.rows[0]||null;
  const nextDirection=change.operation==='create'?record.direction:(record.direction??previous?.direction);
  if(change.operation==='create'){
    if(nextDirection!=='income'&&nextDirection!=='expense')fail(400,'INVALID_TRANSACTION','Invalid direction');
    const needed=nextDirection==='income'?'finance.create_income':'finance.create_expense';
    if(!permissions.has(needed))fail(403,'PERMISSION_DENIED',`Permission required: ${needed}`);
  }
  if((previous?.direction==='income'||nextDirection==='income')&&!permissions.has('finance.view_sensitive'))
    fail(403,'PERMISSION_DENIED','Sensitive finance access required');
  const previousProject=previous?.project_id||null;
  const nextProject=change.operation==='delete'?null:(record.project_id===undefined?previousProject:record.project_id||null);
  for(const projectId of new Set([previousProject,nextProject].filter(Boolean))){
    const access=await getProjectAccess(projectId,user);
    if(access!=='edit'&&access!=='admin')fail(403,'PROJECT_EDIT_DENIED','Project edit access required for finance change');
  }
}else if(!((await getUserPermissions(user.userId,user.role)).has('finance.view_sensitive'))){
  fail(403,'PERMISSION_DENIED','Sensitive finance access required for funding and budget changes');
}
if(change.operation==='delete'){const projectId=record.project_id||existing.rows[0]?.project_id||null;await client.query(`DELETE FROM ${cfg.table} WHERE id=$1`,[entityId]);await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES($1,$2,$3) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[change.entity_type,entityId,projectId]);return{id:entityId,deleted:true};}const allowed=cfg.table==='transactions'?['type','direction','amount','date','vendor','notes','item_id','project_id','funding_source_id','budget_period_id']:cfg.table==='budget_periods'?['label','total_budget','start_date','end_date','notes']:['name','source_type','contact_info','notes'];const fields=allowed.filter(k=>Object.prototype.hasOwnProperty.call(record,k));if(change.operation==='create'&&cfg.table==='transactions'&&!fields.includes('direction'))fail(400,'INVALID_TRANSACTION','direction is required');if(change.operation==='create'){const cols=['id',...fields],vals=[entityId,...fields.map(k=>record[k]??null)];return(await client.query(`INSERT INTO ${cfg.table} (${cols.join(',')}) VALUES (${vals.map((_,i)=>i+1).join(',')}) RETURNING *`,vals)).rows[0];}if(!fields.length)return existing.rows[0];const sets=fields.map((field,i)=>field+'=$'+(i+1)),vals=fields.map(k=>record[k]??null);vals.push(entityId);return(await client.query(`UPDATE ${cfg.table} SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`,vals)).rows[0];}
async function applyMovement(client,change,userId){const payload=object(change.payload,'Movement payload');const itemId=id(payload.item_id||change.entity_id,'Movement item ID');const movementId=id(payload.id,'Movement ID');const type=String(payload.movement_type||'');const quantity=number(payload.quantity,'Movement quantity');if(!MOVEMENT_TYPES.has(type))fail(400,'INVALID_MOVEMENT_TYPE','Invalid movement type');if(quantity<=0)fail(400,'INVALID_QUANTITY','Quantity must be greater than zero');const existing=await client.query('SELECT * FROM item_movements WHERE id=$1',[movementId]);if(existing.rowCount)return{movement:existing.rows[0],item:(await client.query('SELECT * FROM items WHERE id=$1',[itemId])).rows[0]};const itemResult=await client.query('SELECT * FROM items WHERE id=$1 FOR UPDATE',[itemId]);if(!itemResult.rowCount)fail(409,'ITEM_NOT_FOUND',`Item ${itemId} does not exist on the server`);const item=itemResult.rows[0];let next=number(item.current_quantity,'Current quantity');if(INCOMING.has(type))next+=quantity;else if(OUTGOING.has(type))next-=quantity;else if(type==='adjust')next=quantity;if(next<0)fail(409,'INSUFFICIENT_STOCK','Movement would make stock negative');const destinationStorage=type==='transfer'?(payload.to_storage_location?String(payload.to_storage_location).trim():null):(item.storage_location??null);const destinationLocation=type==='transfer'?(payload.to_location_id||item.location_id||null):(payload.to_location_id||null);if(type==='transfer'&&!destinationStorage&&!destinationLocation)fail(400,'TRANSFER_LOCATION_REQUIRED','A destination location is required for transfers');const movement=(await client.query(`INSERT INTO item_movements (id,item_id,movement_type,quantity,quantity_before,quantity_after,from_location_id,to_location_id,from_storage_location,to_storage_location,project_id,reason,reference,performed_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15,now())) RETURNING *`,[movementId,itemId,type,quantity,Number(item.current_quantity),next,item.location_id||null,destinationLocation,item.storage_location||null,destinationStorage,payload.project_id||null,payload.reason||null,payload.reference||null,userId,payload.created_at||null])).rows[0];const updated=(await client.query('UPDATE items SET current_quantity=$1,storage_location=$2,location_id=COALESCE($3,location_id),updated_at=now() WHERE id=$4 RETURNING *',[next,destinationStorage,destinationLocation,itemId])).rows[0];return{movement,item:updated};}
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
 const projectId=record.project_id||null;
 if(projectId){
  const access=await client.query("SELECT 1 FROM projects p WHERE p.id=$1 AND (p.owner_id=$2 OR $3='admin' OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$2 AND pm.member_role IN ('lead','member')))",[projectId,user.userId,user.role]);
  if(!access.rowCount)fail(403,'PROJECT_ACCESS_DENIED','You do not have access to this project');
 }
 const table=cfg.table;
 if(change.operation==='create'){
  if(!String(record.title||'').trim())fail(400,'INVALID_ENGINEERING_RECORD','title is required');
  const existing=await client.query('SELECT * FROM '+table+' WHERE id=$1',[entityId]);
  if(existing.rowCount)return existing.rows[0];
  const fields=cfg.fields.filter(f=>Object.prototype.hasOwnProperty.call(record,f));
  const cols=['id',...fields],vals=[entityId,...fields.map(f=>record[f]??null)];
  if(!fields.includes('created_by')&&table==='engineering_calculations'){cols.push('created_by');vals.push(user.userId);}
  if(!fields.includes('performed_by')&&table==='engineering_tests'){cols.push('performed_by');vals.push(user.userId);}
  const result=await client.query('INSERT INTO '+table+' ('+cols.join(',')+') VALUES ('+vals.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',vals);
  return result.rows[0];
 }
 const existing=await client.query('SELECT * FROM '+table+' WHERE id=$1',[entityId]);
 if(change.operation==='update'){
  if(!existing.rowCount)fail(404,'ENGINEERING_NOT_FOUND','Engineering record not found');
  const fields=cfg.fields.filter(f=>Object.prototype.hasOwnProperty.call(record,f));
  if(!fields.length)return existing.rows[0];
  const vals=fields.map(f=>record[f]??null);
  vals.push(entityId);
  const result=await client.query('UPDATE '+table+' SET '+fields.map((f,i)=>f+'=$'+(i+1)).join(',')+' WHERE id=$'+(fields.length+1)+' RETURNING *',vals);
  return result.rows[0];
 }
 if(change.operation==='delete'){
  if(!existing.rowCount)return {deleted:entityId};
  const projectId=existing.rows[0]?.project_id||null;
  await client.query('DELETE FROM '+table+' WHERE id=$1',[entityId]);
  await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES($1,$2,$3) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[change.entity_type,entityId,projectId]);
  return {deleted:entityId};
 }
 fail(400,'UNSUPPORTED_ENGINEERING_OPERATION','Unsupported engineering operation: '+change.operation);
}


router.get('/notes/pull',async(req,res,next)=>{
  try{
    const permissions=await getUserPermissions(req.user.userId,req.user.role);if(!permissions.has('notes.view'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: notes.view'}});
    const values=req.user.role==='admin'?[]:[req.user.userId];
    const visibility=req.user.role==='admin'?'':'WHERE (n.project_id IS NULL OR n.project_id IN (SELECT p.id FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id WHERE p.owner_id=$1 OR pm.user_id=$1))';
    const notes=await pool.query(`SELECT n.* FROM notes n ${visibility} ORDER BY n.updated_at DESC`,values);
    const tomb=await pool.query("SELECT entity_id FROM sync_tombstones WHERE entity_type='note' AND ($1='admin' OR project_id IS NULL OR project_id IN (SELECT p.id FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id WHERE p.owner_id=$2 OR pm.user_id=$2)) ORDER BY deleted_at DESC LIMIT 1000",[req.user.role,req.user.userId]);
    res.setHeader('Cache-Control','no-store');res.json({notes:notes.rows,deleted_note_ids:tomb.rows.map(r=>r.entity_id)});
  }catch(e){next(e);}
});

router.get('/locations/pull',async(req,res,next)=>{
 try{
  const permissions=await getUserPermissions(req.user.userId,req.user.role);
  if(!permissions.has('inventory.view'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: inventory.view'}});
  const result=await pool.query('SELECT l.*,COUNT(i.id)::int AS item_count FROM locations l LEFT JOIN items i ON i.location_id=l.id GROUP BY l.id ORDER BY l.created_at DESC,l.name ASC');
  const tomb=await pool.query("SELECT entity_id FROM sync_tombstones WHERE entity_type='location' ORDER BY deleted_at DESC LIMIT 1000");
  res.setHeader('Cache-Control','no-store');res.json({locations:result.rows,deleted_location_ids:tomb.rows.map(r=>r.entity_id)});
 }catch(e){next(e);}
});

router.get('/finance/pull',async(req,res,next)=>{
  try {
    const permissions=await getUserPermissions(req.user.userId,req.user.role);
    if(!permissions.has('finance.view'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: finance.view'}});
    const sensitive=permissions.has('finance.view_sensitive');
    const transactions=await pool.query(sensitive?'SELECT * FROM transactions ORDER BY created_at DESC':"SELECT * FROM transactions WHERE direction = 'expense' ORDER BY created_at DESC");
    const [budget_periods,funding_sources]=sensitive?await Promise.all([
      pool.query('SELECT * FROM budget_periods ORDER BY start_date DESC NULLS LAST,created_at DESC'),
      pool.query('SELECT * FROM funding_sources ORDER BY created_at DESC')
    ]):[{rows:[]},{rows:[]}];
    const tomb=await pool.query("SELECT entity_type,entity_id FROM sync_tombstones WHERE entity_type IN ('transaction','budget_period','funding_source') ORDER BY deleted_at DESC LIMIT 1000");
    const deleted={transaction:[],budget_period:[],funding_source:[]};
    for(const r of tomb.rows)if(deleted[r.entity_type]&&(sensitive||r.entity_type==='transaction'))deleted[r.entity_type].push(r.entity_id);
    res.setHeader('Cache-Control','no-store');
    res.json({sensitive_access:sensitive,transactions:sensitive ? transactions.rows : transactions.rows.map(({funding_source_id,budget_period_id,...expense})=>expense),budget_periods:budget_periods.rows,funding_sources:funding_sources.rows,deleted,deleted_transactions:deleted.transaction,deleted_budget_period:deleted.budget_period,deleted_budget_periods:deleted.budget_period,deleted_funding_sources:deleted.funding_source});
  }catch(e){next(e);}
});
router.get('/resources/pull',async(req,res,next)=>{
  try{
    const permissions=await getUserPermissions(req.user.userId,req.user.role);
    if(!permissions.has('resources.view'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: resources.view'}});
    const result=await pool.query('SELECT r.id,r.name,r.kind,r.file_type,r.original_filename,r.mime_type,r.size_bytes,r.parent_resource_id,r.relative_path,r.url,r.thumbnail_url,r.category,r.description,r.tags,r.updated_at,r.created_at,r.item_id,r.project_id,r.note_id FROM resources r ORDER BY r.updated_at DESC');
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
    res.json({resources:visible,deleted_resource_ids:deleted});
  }catch(error){next(error);}
});

router.get('/engineering/pull',async(req,res,next)=>{
 try{
  const permissions=await getUserPermissions(req.user.userId,req.user.role);
  if(!permissions.has('engineering.view'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: engineering.view'}});
  const [calculations,tests,tomb]=await Promise.all([
   pool.query('SELECT * FROM engineering_calculations ORDER BY updated_at DESC,created_at DESC'),
   pool.query('SELECT * FROM engineering_tests ORDER BY updated_at DESC,created_at DESC'),
   pool.query("SELECT entity_type,entity_id FROM sync_tombstones WHERE entity_type IN ('engineering_calculation','engineering_test') AND (project_id IS NULL OR $1='admin' OR project_id IN (SELECT p.id FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id WHERE p.owner_id=$2 OR pm.user_id=$2)) ORDER BY deleted_at DESC LIMIT 1000",[req.user.role,req.user.userId])
  ]);
  const visibleProject=async(row)=>{if(!row.project_id||req.user.role==='admin')return true;const x=await pool.query('SELECT 1 FROM projects p WHERE p.id=$1 AND (p.owner_id=$2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$2))',[row.project_id,req.user.userId]);return x.rowCount>0;};
  const calc=[];for(const row of calculations.rows)if(await visibleProject(row))calc.push(row);
  const tst=[];for(const row of tests.rows)if(await visibleProject(row))tst.push(row);
  const deleted_calculation_ids=tomb.rows.filter(r=>r.entity_type==='engineering_calculation').map(r=>r.entity_id);
  const deleted_test_ids=tomb.rows.filter(r=>r.entity_type==='engineering_test').map(r=>r.entity_id);
  res.setHeader('Cache-Control','no-store');res.json({calculations:calc,tests:tst,deleted_calculation_ids,deleted_test_ids});
 }catch(e){next(e);}
});
router.get('/projects/pull',async(req,res,next)=>{
  try{
    const permissions=await getUserPermissions(req.user.userId,req.user.role);
    if(!permissions.has('projects.view'))return res.status(403).json({error:{code:'PERMISSION_DENIED',message:'Permission required: projects.view'}});
    const values=req.user.role==='admin'?[]:[req.user.userId];
    const visibility=req.user.role==='admin'?'':'WHERE (p.owner_id=$1 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$1))';
    const projects=await pool.query(`SELECT p.* FROM projects p ${visibility} ORDER BY p.updated_at DESC`,values);
    const ids=projects.rows.map(p=>p.id);
    const deletedRows=await pool.query("SELECT entity_type,entity_id FROM sync_tombstones WHERE entity_type IN ('project','project_task','project_experiment','project_bom','project_block','project_connector','project_experiment_measurement','project_experiment_observation','project_task_experiment','project_work_attachment','project_resource_requirement') AND (project_id=ANY($1::uuid[]) OR (project_id IS NULL AND entity_type='project')) ORDER BY deleted_at DESC LIMIT 2500",[ids]); const deletedByType={project:[],project_task:[],project_experiment:[],project_bom:[],project_block:[],project_connector:[],project_experiment_measurement:[],project_experiment_observation:[],project_task_experiment:[],project_work_attachment:[],project_resource_requirement:[]}; for(const row of deletedRows.rows)if(deletedByType[row.entity_type])deletedByType[row.entity_type].push(row.entity_id); if(!ids.length)return res.json({projects:[],deleted_project_ids:deletedByType.project,deleted_project_entities:deletedByType});
    const [tasks,experiments,bom,items,blocks,connectors,measurements,observations,taskExperiments,attachments,requirements]=await Promise.all([
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
      pool.query('SELECT * FROM project_resource_requirements WHERE project_id=ANY($1::uuid[]) ORDER BY required_by NULLS LAST,created_at',[ids])
    ]);
    const by=(rows,key)=>{const m=new Map();for(const row of rows){const id=row[key];if(!m.has(id))m.set(id,[]);m.get(id).push(row);}return m;};
    const taskMap=by(tasks.rows,'project_id'),taskExperimentMap=by(taskExperiments.rows,'task_id'),taskExperimentProjectMap=by(taskExperiments.rows,'project_id'),experimentMap=by(experiments.rows,'project_id'),bomMap=by(bom.rows,'project_id'),itemMap=by(items.rows,'project_id'),blockMap=by(blocks.rows,'project_id'),connectorMap=by(connectors.rows,'project_id'),measurementMap=by(measurements.rows,'experiment_id'),observationMap=by(observations.rows,'experiment_id'),attachmentTaskMap=by(attachments.rows,'task_id'),attachmentExperimentMap=by(attachments.rows,'experiment_id'),requirementMap=by(requirements.rows,'project_id');
    for(const e of experiments.rows){e.measurements=measurementMap.get(e.id)||[];e.observations=observationMap.get(e.id)||[];e.attachments=attachmentExperimentMap.get(e.id)||[];}
    for(const t of tasks.rows){t.attachments=attachmentTaskMap.get(t.id)||[];t.experiments=taskExperimentMap.get(t.id)||[];}
    res.setHeader('Cache-Control','no-store');
    res.json({projects:projects.rows.map(p=>({...p,tasks:taskMap.get(p.id)||[],experiments:experimentMap.get(p.id)||[],bom:bomMap.get(p.id)||[],items:itemMap.get(p.id)||[],blocks:blockMap.get(p.id)||[],connectors:connectorMap.get(p.id)||[],requirements:requirementMap.get(p.id)||[],task_experiments:taskExperimentProjectMap.get(p.id)||[]})),deleted_project_ids:deletedByType.project,deleted_project_entities:deletedByType});
  }catch(error){next(error);}
});
router.get('/pull',async(req,res,next)=>{try{const raw=typeof req.query.since==='string'?req.query.since.trim():'';let cursor=null;if(raw){cursor=decodePullCursor(raw);if(!cursor){const legacy=new Date(raw);if(Number.isNaN(legacy.getTime()))return res.status(400).json({error:{code:'INVALID_SYNC_CURSOR',message:'since must be a valid inventory sync cursor'}});cursor={at:legacy.toISOString(),type:'',id:''};}}const limit=Math.min(500,Math.max(1,Number(req.query.limit||500)));const values=cursor?[cursor.at,cursor.type,cursor.id,limit+1]:[limit+1];const where=cursor?`WHERE event_at > $1 OR (event_at = $1 AND (event_type > $2 OR (event_type = $2 AND event_id > $3)))`:'';const result=await pool.query(`SELECT event_type,event_id,event_at,item,deleted FROM (SELECT 'item'::text AS event_type,id::text AS event_id,updated_at AS event_at,to_jsonb(items) AS item,false AS deleted FROM items UNION ALL SELECT 'delete'::text AS event_type,entity_id::text AS event_id,deleted_at AS event_at,NULL::jsonb AS item,true AS deleted FROM sync_tombstones WHERE entity_type='item') events ${where} ORDER BY event_at ASC,event_type ASC,event_id ASC LIMIT $${values.length}`,values);const rows=result.rows;const hasMore=rows.length>limit;const page=hasMore?rows.slice(0,limit):rows;const last=page[page.length-1];const nextCursor=last?encodePullCursor(last.event_at,last.event_type,last.event_id):(cursor?raw:null);res.setHeader('Cache-Control','no-store');res.json({items:page.filter(row=>!row.deleted).map(row=>row.item),deleted_item_ids:page.filter(row=>row.deleted).map(row=>row.event_id),next_cursor:nextCursor,has_more:hasMore});}catch(error){next(error);}});
router.post('/push',async(req,res,next)=>{const body=object(req.body,'Sync request');const deviceId=typeof body.device_id==='string'&&body.device_id.trim()?body.device_id.trim():null;const changes=Array.isArray(body.changes)?body.changes:null;if(!deviceId)return res.status(400).json({error:{code:'DEVICE_ID_REQUIRED',message:'device_id is required'}});if(!changes)return res.status(400).json({error:{code:'CHANGES_REQUIRED',message:'changes must be an array'}});if(changes.length>100)return res.status(413).json({error:{code:'SYNC_BATCH_TOO_LARGE',message:'A maximum of 100 changes can be synchronized per request'}});try{const permissions=await getUserPermissions(req.user.userId,req.user.role);const results=[];for(const raw of changes){const change=object(raw,'Sync change');if(typeof change.change_id!=='string'||!change.change_id.trim()){results.push({change_id:null,status:'rejected',error:{code:'CHANGE_ID_REQUIRED',message:'change_id is required'}});continue;}const entityType=String(change.entity_type||''),operation=String(change.operation||'');const required=entityType==='note'?(operation==='create'?'notes.create':operation==='delete'?'notes.delete':'notes.edit'):knowledgeEntityType(entityType)?'projects.edit':entityType==='project_item'?'projects.edit':engineeringEntityType(entityType)?(operation==='create'?'engineering.create':operation==='delete'?'engineering.delete':'engineering.edit'):entityType==='item_movement'?'inventory.adjust_stock':entityType==='resource_download_job'?'resources.edit':entityType==='resource'?(operation==='create'?'resources.create':operation==='delete'?'resources.delete':'resources.edit'):entityType==='location'?(operation==='create'?'inventory.create':operation==='delete'?'inventory.delete':'inventory.edit'):projectEntityType(entityType)?(operation==='create'?'projects.create':operation==='delete'?'projects.delete':'projects.edit'):FINANCE_CONFIG[entityType]?(operation==='create'?(entityType==='transaction'?'finance.create_expense':'finance.edit'):operation==='delete'?'finance.delete':'finance.edit'):operation==='bulk_delete'?'inventory.delete':operation==='bulk_status'?'inventory.edit':'inventory.edit';if(!permissions.has(required)){results.push({change_id:change.change_id,status:'rejected',error:{code:'PERMISSION_DENIED',message:`Permission required: ${required}`}});continue;}change.__role=req.user.role;const client=await pool.connect();try{await client.query('BEGIN');const prior=await client.query('SELECT payload_json,response_json FROM sync_idempotency WHERE change_id=$1 FOR UPDATE',[change.change_id]);if(prior.rowCount){const same=(await client.query('SELECT $1::jsonb = $2::jsonb AS same',[prior.rows[0].payload_json,change.payload])).rows[0].same;if(!same){await client.query('ROLLBACK');results.push({change_id:change.change_id,status:'rejected',error:{code:'IDEMPOTENCY_PAYLOAD_MISMATCH',message:'change_id was already used with a different payload'}});continue;}await client.query('COMMIT');results.push({change_id:change.change_id,status:'synced',result:prior.rows[0].response_json});continue;}const result=await applyChange(client,change,req.user.userId);await client.query('INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,200)',[change.change_id,deviceId,req.user.userId,entityType,change.entity_id||null,operation,change.payload,result]);await client.query('COMMIT');
      await writeAuditLog({req,actorUserId:req.user.userId,action:`sync:${operation}`,entityType,entityId:typeof change.entity_id==='string'&&/^[0-9a-f-]{32,36}$/i.test(change.entity_id)?change.entity_id:null,newValue:result,deviceId,metadata:{sync_mode:'online',authorization:'server',sync_entity_id:change.entity_id||null}});
      results.push({change_id:change.change_id,status:'synced',result});}catch(error){await client.query('ROLLBACK').catch(()=>{});if(error?.code==='23505'){const prior=await pool.query('SELECT payload_json,response_json FROM sync_idempotency WHERE change_id=$1',[change.change_id]);if(prior.rowCount){const same=(await pool.query('SELECT $1::jsonb = $2::jsonb AS same',[prior.rows[0].payload_json,change.payload])).rows[0].same;if(same){results.push({change_id:change.change_id,status:'synced',result:prior.rows[0].response_json});continue;}}}const status=Number(error?.status)>=400&&Number(error?.status)<500?'rejected':'failed';results.push({change_id:change.change_id,status,error:{code:error?.code||'SYNC_APPLY_FAILED',message:error?.message||'Unable to apply sync change'}});}finally{client.release();}}res.json({device_id:deviceId,accepted:results.filter(r=>r.status==='synced').length,results});}catch(error){next(error);}});

const NOTE_FIELDS=['title','body','tags','item_id','project_id'];

async function applyNoteEntity(client,change,user){
  const payload=object(change.payload,'Note sync payload');
  const record=payload.note||payload.record||payload;
  const entityId=id(record.id||payload.id||change.entity_id,'Note ID');
  const required=change.operation==='create'?'notes.create':change.operation==='delete'?'notes.delete':'notes.edit';
  const permissions=await getUserPermissions(user.userId,user.role);
  if(!permissions.has(required))fail(403,'PERMISSION_DENIED',`Permission required: ${required}`);
  const access=await getProjectAccess(record.project_id||null,user);
  if(access.access==='none'||access.access==='view'&&record.project_id)fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');
  const existing=await client.query('SELECT * FROM notes WHERE id=$1 FOR UPDATE',[entityId]);

  if(change.operation==='create'){
    if(existing.rowCount)return existing.rows[0];
    if(!String(record.title||'').trim())fail(400,'INVALID_NOTE','Note title is required');
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
    return(await client.query('INSERT INTO notes ('+columns.join(',')+') VALUES ('+placeholders+') RETURNING *',values)).rows[0];
  }

  if(!existing.rowCount&&change.operation==='delete')return{deleted:true,id:entityId,already_deleted:true};
  if(!existing.rowCount)fail(409,'NOTE_NOT_FOUND',`Note ${entityId} does not exist on the server`);
  if(change.operation==='delete'){
    await client.query('DELETE FROM notes WHERE id=$1',[entityId]);
    await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES('note',$1,$2) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[entityId,existing.rows[0].project_id||null]);
    return{deleted:true,id:entityId};
  }

  const current=existing.rows[0];
  const destinationProject=Object.prototype.hasOwnProperty.call(record,'project_id')?record.project_id:current.project_id;
  const currentAccess=await getProjectAccess(current.project_id||null,user);
  const destinationAccess=await getProjectAccess(destinationProject||null,user);
  if(currentAccess.access==='none'||currentAccess.access==='view'&&current.project_id)fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');
  if(destinationAccess.access==='none'||destinationAccess.access==='view'&&destinationProject)fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');

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
  return(await client.query('UPDATE notes SET '+updates.join(',')+',updated_at=now() WHERE id=$'+values.length+' RETURNING *',values)).rows[0];
}

const KNOWLEDGE_CONFIG={
  finding:{table:'lab_findings',fields:['project_id','experiment_id','title','body','status','confidence','tags']},
  knowledge_result:{table:'lab_results',fields:['project_id','experiment_id','finding_id','title','summary','value_numeric','value_text','unit']},
  knowledge_relationship:{table:'knowledge_relationships',fields:['project_id','source_type','source_id','target_type','target_id','relationship']}
};
function knowledgeEntityType(value){return Object.prototype.hasOwnProperty.call(KNOWLEDGE_CONFIG,value);}

async function applyKnowledgeEntity(client,change,user){
  const cfg=KNOWLEDGE_CONFIG[change.entity_type];
  if(!cfg)fail(400,'UNSUPPORTED_KNOWLEDGE_ENTITY','Unsupported knowledge entity');
  const payload=object(change.payload,'Knowledge sync payload');
  const record=payload.record||payload.finding||payload.result||payload.relationship||payload;
  const entityId=id(record.id||payload.id||change.entity_id,'Knowledge entity ID');
  const projectId=record.project_id||null;
  if(projectId&&!(await canEditProject(client,projectId,user)))fail(403,'PROJECT_ACCESS_DENIED','You do not have edit access to this project');

  const existing=await client.query('SELECT * FROM '+cfg.table+' WHERE id=$1 FOR UPDATE',[entityId]);

  if(change.operation==='create'){
    if(existing.rowCount)return existing.rows[0];
    if(change.entity_type==='knowledge_relationship'){
      const values=[entityId],columns=['id'];
      for(const field of cfg.fields)if(Object.prototype.hasOwnProperty.call(record,field)){columns.push(field);values.push(record[field]??null);}
      columns.push('created_by');values.push(user.userId);
      const placeholders=values.map((_,i)=>'$'+(i+1)).join(',');
      return(await client.query('INSERT INTO '+cfg.table+' ('+columns.join(',')+') VALUES ('+placeholders+') RETURNING *',values)).rows[0];
    }
    if(!String(record.title||'').trim())fail(400,'INVALID_KNOWLEDGE_RECORD','title is required');
    const values=[entityId],columns=['id'];
    for(const field of cfg.fields)if(Object.prototype.hasOwnProperty.call(record,field)){columns.push(field);values.push(field==='title'?String(record[field]??'').trim():record[field]??null);}
    columns.push('created_by','updated_by');values.push(user.userId,user.userId);
    const placeholders=values.map((_,i)=>'$'+(i+1)).join(',');
    return(await client.query('INSERT INTO '+cfg.table+' ('+columns.join(',')+') VALUES ('+placeholders+') RETURNING *',values)).rows[0];
  }

  if(!existing.rowCount&&change.operation==='delete')return{deleted:true,id:entityId,already_deleted:true};
  if(!existing.rowCount)fail(409,'KNOWLEDGE_ENTITY_NOT_FOUND',change.entity_type+' '+entityId+' does not exist on the server');

  if(change.operation==='delete'){
    await client.query('DELETE FROM '+cfg.table+' WHERE id=$1',[entityId]);
    await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES($1,$2,$3) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[change.entity_type,entityId,existing.rows[0]?.project_id||null]);
    return{deleted:true,id:entityId};
  }

  if(change.entity_type==='knowledge_relationship')fail(400,'UNSUPPORTED_KNOWLEDGE_OPERATION','Knowledge relationships support create and delete only');

  const updates=[],values=[];
  for(const field of cfg.fields){
    if(['project_id'].includes(field))continue;
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


async function applyChange(client,change,userId){if(change.entity_type==='resource_download_job')return applyResourceDownloadJobEntity(client,change,{userId,role:change.__role});if(change.entity_type==='note')return applyNoteEntity(client,change,{userId,role:change.__role});if(change.entity_type==='project_item')return applyProjectItemEntity(client,change,{userId,role:change.__role});if(change.entity_type==='project_task_experiment')return applyProjectTaskExperimentEntity(client,change,{userId,role:change.__role});if(knowledgeEntityType(change.entity_type))return applyKnowledgeEntity(client,change,{userId,role:change.__role});if(change.entity_type==='location')return applyLocationEntity(client,change,{userId,role:change.__role});if(engineeringEntityType(change.entity_type))return applyEngineeringEntity(client,change,{userId,role:change.__role});if(projectEntityType(change.entity_type))return applyProjectEntity(client,change,{userId,role:change.__role});if(change.entity_type==='resource')return applyResourceEntity(client,change,{userId,role:change.__role});if(FINANCE_CONFIG[change.entity_type])return applyFinanceEntity(client,change,{userId,role:change.__role});if(change.operation==='bulk_status'){const p=object(change.payload,'Bulk status payload');const ids=Array.isArray(p.ids)?p.ids:[];if(!ids.length||typeof p.status!=='string')fail(400,'INVALID_BULK_STATUS','ids and status are required');return{updated:Number((await client.query('UPDATE items SET status=$1,updated_at=now() WHERE id=ANY($2::uuid[])',[p.status,ids])).rowCount)};}if(change.operation==='bulk_delete'){const p=object(change.payload,'Bulk delete payload');const ids=Array.isArray(p.ids)?p.ids:[];if(!ids.length)return{deleted:0};const result=await client.query('DELETE FROM items WHERE id=ANY($1::uuid[]) RETURNING id', [ids]);for(const row of result.rows)await client.query("INSERT INTO sync_tombstones(entity_type,entity_id) VALUES('item',$1) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now()",[row.id]);return{deleted:Number(result.rowCount)};}if(change.entity_type==='item')return applyItem(client,change);if(change.entity_type==='item_movement'&&change.operation==='create')return applyMovement(client,change,userId);fail(400,'UNSUPPORTED_SYNC_CHANGE',`Unsupported sync change: ${change.entity_type}/${change.operation}`);}

export default router;
