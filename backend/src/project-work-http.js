import {workFields,reviewedWork} from './project-work-review.js';
export {workFields,workSnapshot,reviewedWork} from './project-work-review.js';
import {pool} from './db.js';
import {catalogUuid} from './catalog-sync.js';
import {requireProjectWorkAuthority} from './project-work-authority.js';
import {applyProjectWorkAttachment,requireProjectAttachmentResource} from './project-work-attachment.js';
import {writeAuditLog} from './middleware/audit.js';
import {projectDateValue} from './project-date-value.js';
import {assertExperimentObservationText} from './project-experiment-observations.js';
import {projectPlanningQuantity,applyProjectItemIntent} from './project-planning-intents.js';
import {canvasRecord,authorizeCanvasResource,assertRequirementRemovable} from './project-canvas-contract.js';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export function projectWorkFlatMutation(kind,operation){
 const field={block:'blockId',connector:'connectorId',requirement:'requirementId'}[kind];
 if(!field)throw Error('Unsupported flat project work route');
 const handler=projectWorkHttpMutation(kind,operation);
 return (req,res,next)=>{req.params={id:req.body?.project_id,[field]:req.params.id};return handler(req,res,next);};
}
const tables={task:'project_tasks',experiment:'project_experiments',measurement:'project_experiment_measurements',observation:'project_experiment_observations',bom:'project_bom_items',block:'project_blocks',connector:'project_connectors',requirement:'project_resource_requirements'};

function patch(kind,body){
 const result=Object.fromEntries(workFields[kind].filter(f=>Object.hasOwn(body,f)).map(f=>[f,projectDateValue(f,body[f])]));
 for(const field of ['title','description','status','priority','hypothesis','procedure','observations','result','conclusion','name','unit','notes','kind','content','requirement_type'])if(Object.hasOwn(result,field)&&!(['bom','requirement'].includes(kind)&&field==='unit'&&result[field]===null)&&!(kind==='block'&&['title'].includes(field)&&result[field]===null)&&typeof result[field]!=='string')fail(400,'PROJECT_WORK_INVALID',`${field} must be text`);
 for(const field of ['assignee_id','performed_by','requirement_id','recorded_by','preferred_item_id','alternative_item_id','resource_id','source_block_id','target_block_id'])if(result[field]!=null)result[field]=catalogUuid(result[field]);
 if(kind==='bom'&&Object.hasOwn(result,'required_quantity'))result.required_quantity=projectPlanningQuantity(result.required_quantity);
 if(kind==='bom'&&result.part_number!=null&&typeof result.part_number!=='string')fail(400,'PROJECT_WORK_INVALID','Part number must be text');
 if(Object.hasOwn(result,'observed_at')){
  if(result.observed_at==='')result.observed_at=null;
  if(result.observed_at!=null&&(typeof result.observed_at!=='string'||Number.isNaN(Date.parse(result.observed_at))))fail(400,'PROJECT_WORK_INVALID','Invalid observation time');
 }
 for(const field of ['value_numeric','uncertainty'])if(result[field]!=null&&(typeof result[field]==='boolean'||String(result[field]).trim()===''||!Number.isFinite(Number(result[field]))||field==='uncertainty'&&Number(result[field])<0))fail(400,'PROJECT_WORK_INVALID',`Invalid ${field}`);
 if(Object.hasOwn(result,'title')){
  if(typeof result.title!=='string'||!result.title.trim())fail(400,'PROJECT_WORK_INVALID','A title is required');result.title=result.title.trim();
 }
 if(result.status!=null&&!(kind==='requirement'?['required','available','allocated','ordered','fulfilled','cancelled']:kind==='task'?['todo','in_progress','blocked','done','cancelled']:['planned','running','completed','failed','cancelled']).includes(result.status))fail(400,'PROJECT_WORK_INVALID','Invalid work status');
 if(kind==='task'&&result.priority!=null&&!['low','normal','high','critical'].includes(result.priority))fail(400,'PROJECT_WORK_INVALID','Invalid priority');
 if(kind==='experiment')assertExperimentObservationText(result);
 return result;
}
async function tombstoneChildren(client,kind,id,projectId){
 const parent=kind==='task'?'task_id':'experiment_id';
 const children=[['project_task_experiment','project_task_experiments'],['project_work_attachment','project_work_attachments'],...(kind==='experiment'?[['project_experiment_measurement','project_experiment_measurements'],['project_experiment_observation','project_experiment_observations']]:[])];
 for(const [type,table] of children)await client.query(`INSERT INTO sync_tombstones(entity_type,entity_id,project_id) SELECT $1,id,$3::uuid FROM ${table} WHERE ${parent}=$2 ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id`,[type,id,projectId]);
}

// Browser-only transport. Desktop ordinary writes stay in SQLite + the outbox.
// Receipts, audit, tombstones and the effect share one transaction. Replays
// recheck current authority but never reapply a mutation to a newer record.
export function projectWorkHttpMutation(kind,operation){
 if(!['task','experiment','link','measurement','observation','task_attachment','experiment_attachment','bom','item','block','connector','requirement'].includes(kind)||!['create','update','delete','repeat'].includes(operation)||(kind==='connector'||kind==='link'||kind==='item'||kind.endsWith('_attachment'))&&!['create','delete'].includes(operation)||operation==='repeat'&&kind!=='experiment')throw Error('Unsupported work mutation');
 return async(req,res,next)=>{
  let c;
  try{
   const body=req.body||{},key=catalogUuid(req.get('Idempotency-Key')),projectId=catalogUuid(req.params.projectId||req.params.id);
   const nested=['measurement','observation'].includes(kind);
   const attachment=kind.endsWith('_attachment');
   const workParentField=kind==='task_attachment'?'task_id':'experiment_id';
   const workParentId=attachment?catalogUuid(kind==='task_attachment'?req.params.taskId:req.params.experimentId):null;
   const resourceId=attachment?catalogUuid(operation==='create'?body.resource_id:body.expected_resource_id):null;
   const itemId=kind==='item'?catalogUuid(operation==='create'?body.item_id:req.params.itemId):null;
   const parentId=nested?catalogUuid(req.params.experimentId):null;
   const recordId=kind==='item'?itemId:operation==='create'?key:catalogUuid(attachment?req.params.attachmentId:kind==='block'?req.params.blockId:kind==='connector'?req.params.connectorId:kind==='requirement'?req.params.requirementId:kind==='bom'?req.params.bomId:kind==='task'?req.params.taskId:kind==='measurement'?req.params.measurementId:kind==='observation'?req.params.observationId:req.params.experimentId);
   const taskId=kind==='link'?catalogUuid(req.params.taskId):null;
   const experimentId=kind==='link'?catalogUuid(operation==='create'?body.experiment_id:req.params.experimentId):null;
   const payload={project_id:projectId,record_id:recordId,...(attachment?{[workParentField]:workParentId}:{}),...(nested?{experiment_id:parentId}:{}),...(kind==='link'?{task_id:taskId,experiment_id:experimentId}:{}),body};
   c=await pool.connect();await c.query('BEGIN');
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+key]);
   const actor=await requireProjectWorkAuthority(c,projectId,req.user.userId);
   const prior=(await c.query('SELECT * FROM sync_idempotency WHERE change_id=$1 FOR UPDATE',[key])).rows[0];
   let result,status=operation==='delete'?204:['create','repeat'].includes(operation)?201:200;
   const entityType=kind==='requirement'?'project_resource_requirement':attachment?'project_work_attachment':kind==='link'?'project_task_experiment':nested?`project_experiment_${kind}`:`project_${kind}`;
   if(prior){
    const same=(await c.query('SELECT $1::jsonb=$2::jsonb AS same',[prior.payload_json,payload])).rows[0].same;
    if(prior.user_id!==req.user.userId||prior.device_id!=='project-work-http'||prior.entity_type!==entityType||prior.operation!==operation||!same)fail(409,'IDEMPOTENCY_MISMATCH','Retry key belongs to another work change');
    if(attachment&&operation==='create')await requireProjectAttachmentResource(c,projectId,resourceId,req.user);
    if(kind==='block'&&operation!=='delete'&&prior.response_json?.resource_id)await authorizeCanvasResource(c,prior.response_json.resource_id,projectId,actor);
    result=prior.response_json;status=prior.response_status;
   }else{
    let before=null;
    if(kind==='item'){
     if(!Object.hasOwn(body,'expected'))fail(400,'PROJECT_ITEM_BASE_REQUIRED','Supply the reviewed item link; null means no existing link');
     const applied=await applyProjectItemIntent(c,{operation:operation==='create'?'upsert':'delete',payload:{record:{...body,project_id:projectId,item_id:itemId},expected:body.expected}},req.user);
     before=applied.before;result=applied.result;
    }else if(attachment){
     const applied=await applyProjectWorkAttachment(c,{entity_id:recordId,operation,payload:{record:{id:recordId,project_id:projectId,[workParentField]:workParentId,resource_id:resourceId}}},req.user);
     before=applied.before;result=applied.result;
    }else if(kind==='link'){
     for(const [table,id] of [['project_tasks',taskId],['project_experiments',experimentId]])if(!(await c.query(`SELECT id FROM ${table} WHERE id=$1 AND project_id=$2 FOR KEY SHARE`,[id,projectId])).rowCount)fail(404,'PROJECT_WORK_NOT_FOUND','Task or experiment not found in project');
     before=(await c.query('SELECT * FROM project_task_experiments WHERE task_id=$1 AND experiment_id=$2 AND project_id=$3 FOR UPDATE',[taskId,experimentId,projectId])).rows[0]??null;
     if(!Object.hasOwn(body,'expected_relationship')||(before?.relationship??null)!==body.expected_relationship)fail(409,'PROJECT_LINK_CHANGED','Link changed; refresh and review before retrying');
     if(operation==='delete'){
      if(!before)fail(404,'PROJECT_WORK_NOT_FOUND','Link not found');
      await c.query('DELETE FROM project_task_experiments WHERE id=$1',[before.id]);result={id:before.id,deleted:true};
     }else{
      const relationship=body.relationship??'related';
      if(!['related','drives','validates','blocked_by'].includes(relationship))fail(400,'PROJECT_LINK_INVALID','Invalid relationship');
      // Do not upsert over an absent reviewed base: a concurrent sync insert
      // must conflict, rather than silently replacing its relationship.
      result=before?(await c.query('UPDATE project_task_experiments SET relationship=$1 WHERE id=$2 RETURNING *',[relationship,before.id])).rows[0]:(await c.query('INSERT INTO project_task_experiments(id,project_id,task_id,experiment_id,relationship,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[key,projectId,taskId,experimentId,relationship,req.user.userId])).rows[0];
     }
    }else{
     const table=tables[kind];
     if(nested&&!(await c.query('SELECT id FROM project_experiments WHERE id=$1 AND project_id=$2 FOR KEY SHARE',[parentId,projectId])).rowCount)fail(404,'PROJECT_WORK_NOT_FOUND','Experiment not found in project');
     const scopeColumn=nested?'experiment_id':'project_id',scopeId=nested?parentId:projectId;
     if(operation!=='create'){
      before=(await c.query(`SELECT * FROM ${table} WHERE id=$1 AND ${scopeColumn}=$2 FOR UPDATE`,[recordId,scopeId])).rows[0];
      if(!before)fail(404,'PROJECT_WORK_NOT_FOUND','Work not found');
      reviewedWork(kind,body.expected,before);
     }
     if(operation==='delete'){
      if(kind==='task'||kind==='experiment')await tombstoneChildren(c,kind,recordId,projectId);
      if(kind==='block')await c.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id) SELECT 'project_connector',id,project_id FROM project_connectors WHERE source_block_id=$1 OR target_block_id=$1 ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id",[recordId]);
      if(kind==='requirement')await assertRequirementRemovable(c,recordId);
      await c.query(`DELETE FROM ${table} WHERE id=$1 AND ${scopeColumn}=$2`,[recordId,scopeId]);result={id:recordId,deleted:true};
     }else{
      let data=operation==='repeat'?{title:`${before.title} (repeat)`,status:'planned',hypothesis:before.hypothesis||'',procedure:before.procedure||'',observations:'',result:'',conclusion:'',performed_by:req.user.userId}:patch(kind,body);
      if(operation==='update'&&!Object.keys(data).length)fail(400,'PROJECT_WORK_INVALID','No work fields to update');
      if(!nested&&['task','experiment'].includes(kind)&&operation!=='update'&&!data.title)fail(400,'PROJECT_WORK_INVALID','A title is required');
      const merged={...before,...data};
      if(kind==='block'){
       const checked=canvasRecord(merged);
       for(const field of ['x','y','width','height'])if(operation==='create'||Object.hasOwn(data,field))data[field]=checked[field];
       if(checked.resource_id)await authorizeCanvasResource(c,checked.resource_id,projectId,actor);
      }
      if(kind==='connector'){
       if(!data.source_block_id||!data.target_block_id||data.source_block_id===data.target_block_id)fail(400,'INVALID_PROJECT_CONNECTOR','Choose two different canvas blocks');
       const blocks=(await c.query('SELECT id,resource_id FROM project_blocks WHERE id=ANY($1::uuid[]) AND project_id=$2 ORDER BY id FOR KEY SHARE',[[data.source_block_id,data.target_block_id],projectId])).rows;
       if(blocks.length!==2)fail(400,'INVALID_PROJECT_CONNECTOR','Connector endpoints must belong to this project');
       for(const block of blocks)if(block.resource_id)await authorizeCanvasResource(c,block.resource_id,projectId,actor);
       if(data.label!=null&&typeof data.label!=='string')fail(400,'INVALID_PROJECT_CONNECTOR','Connector label must be text');
      }
      if(kind==='requirement'){
       if(typeof merged.name!=='string'||!merged.name.trim())fail(400,'PROJECT_WORK_INVALID','Requirement name is required');
       if(!['component','equipment','tool','material','consumable','resource','other'].includes(merged.requirement_type??'component'))fail(400,'PROJECT_WORK_INVALID','Invalid requirement type');
       data.quantity=projectPlanningQuantity(merged.quantity??1);
       if(merged.preferred_item_id&&(!actor.permissions.has('inventory.view')||!(await c.query('SELECT id FROM items WHERE id=$1 FOR KEY SHARE',[merged.preferred_item_id])).rowCount))fail(400,'PROJECT_WORK_INVALID','Preferred item is unavailable');
      }
      if(kind==='bom'){
       if(typeof merged.name!=='string'||!merged.name.trim())fail(400,'PROJECT_WORK_INVALID','BOM name is required');
       data.name=merged.name.trim();data.required_quantity=projectPlanningQuantity(merged.required_quantity??1);
       const ids=[...new Set([merged.preferred_item_id,merged.alternative_item_id].filter(Boolean))];
       if(ids.length&&(!(await requireProjectWorkAuthority(c,projectId,req.user.userId)).permissions.has('inventory.view')||(await c.query('SELECT id FROM items WHERE id=ANY($1::uuid[]) FOR KEY SHARE',[ids])).rowCount!==ids.length))fail(400,'PROJECT_WORK_INVALID','BOM inventory matches must reference available items');
      }
      if(kind==='measurement'&&(!String(merged.name||'').trim()||merged.value_numeric==null&&merged.value_text==null))fail(400,'PROJECT_WORK_INVALID','Measurement needs a name and a numeric or text value');
      if(kind==='measurement'&&merged.value_text!=null&&typeof merged.value_text!=='string')fail(400,'PROJECT_WORK_INVALID','Measurement text must be text');
      if(kind==='observation'&&!String(merged.content||'').trim())fail(400,'PROJECT_WORK_INVALID','Observation content is required');
      if(data.requirement_id&&!(await c.query('SELECT id FROM project_resource_requirements WHERE id=$1 AND project_id=$2 FOR KEY SHARE',[data.requirement_id,projectId])).rowCount)fail(400,'INVALID_PROJECT_REQUIREMENT','Requirement must belong to this project');
      const fields=Object.keys(data),values=Object.values(data);
      if(!fields.length)fail(400,'PROJECT_WORK_INVALID','No work fields to update');
      if(operation==='update')result=(await c.query(`UPDATE ${table} SET ${fields.map((f,i)=>`${f}=$${i+1}`).join(',')},updated_at=now() WHERE id=$${values.length+1} AND ${scopeColumn}=$${values.length+2} RETURNING *`,[...values,recordId,scopeId])).rows[0];
      else{
       const actorField=kind==='task'||kind==='bom'||kind==='requirement'?'created_by':nested?'recorded_by':kind==='experiment'?'performed_by':null;if(actorField&&!fields.includes(actorField)){fields.push(actorField);values.push(req.user.userId);}
       const columns=['id',scopeColumn,...fields];result=(await c.query(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,[key,scopeId,...values])).rows[0];
      }
     }
    }
    if(!result)fail(500,'PROJECT_WORK_CONFIRMATION_MISSING','Database did not confirm work');
    if(nested)result={...result,project_id:projectId};
    if(operation==='delete'&&!attachment&&kind!=='item')await c.query('INSERT INTO sync_tombstones(entity_type,entity_id,project_id) VALUES($1,$2,$3) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id',[entityType,result.id,projectId]);
    await writeAuditLog({req,action:operation==='delete'?'DELETE':operation==='update'||kind==='link'&&before?'UPDATE':'CREATE',entityType,entityId:result.id,oldValue:before,newValue:operation==='delete'?null:result,metadata:{project_id:projectId,change_id:key,...(nested?{experiment_id:parentId}:{}),...(kind==='link'?{task_id:taskId,experiment_id:experimentId}:{}),...(operation==='repeat'?{repeated_from:recordId}:{})},client:c,required:true});
    await c.query("INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,'project-work-http',$2,$3,$4,$5,$6,$7,$8)",[key,req.user.userId,entityType,result.id,operation,payload,result,status]);
   }
   await c.query('COMMIT');if(status===204)res.status(204).send();else res.status(status).json(result);
  }catch(error){
   if(c)await c.query('ROLLBACK').catch(()=>{});
   if(error.status)return res.status(error.status).json({error:{code:error.code,message:error.message}});
   if(error.code==='23505')return res.status(409).json({error:{code:'PROJECT_WORK_CHANGED',message:'Work identity or relationship changed; refresh and review'}});
   if(error.code==='23503')return res.status(400).json({error:{code:'PROJECT_WORK_REFERENCE_INVALID',message:'A referenced project work record is unavailable'}});
   next(error);
  }finally{c?.release();}
 };
}
