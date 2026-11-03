import {getResourceContext} from './middleware/resource-access.js';
import {resourceBindings} from './resource-authority.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export function canvasRecord(record){
 if(!['text','image','video','audio','pdf','link','folder'].includes(record.block_type))fail(400,'CANVAS_CONTENT_INVALID','Invalid canvas block type');
 if(record.block_type==='text'&&(typeof record.text_content!=='string'||!record.text_content.trim())||record.block_type!=='text'&&!record.resource_id)fail(400,'CANVAS_CONTENT_INVALID','Supply block text or a resource');
 for(const field of ['text_content','title'])if(record[field]!=null&&typeof record[field]!=='string')fail(400,'CANVAS_CONTENT_INVALID','Canvas text must be text');
 const geometry={};
 for(const [field,fallback] of [['x',0],['y',0],['width',320],['height',200]]){
  const value=record[field]===undefined?fallback:record[field];
  if(!['number','string'].includes(typeof value)||String(value).trim()===''||!Number.isFinite(Number(value)))fail(400,'INVALID_GEOMETRY','Canvas geometry must contain finite numbers');
  geometry[field]=Math.round(Number(value));
  if(geometry[field]<-2147483648||geometry[field]>2147483647)fail(400,'INVALID_GEOMETRY','Canvas geometry exceeds supported bounds');
 }
 if(geometry.width<120||geometry.height<80)fail(400,'INVALID_GEOMETRY','Canvas block is below the minimum size');
 return {...record,...geometry};
}
export function canvasContextAllowed(context,projectId,actor,grants){
 if(!context||context.invalid||!Array.isArray(context.resources)||context.projectId&&context.projectId!==projectId)return false;
 const visible=(kind,id,visibility,scope)=>actor.role==='admin'||(visibility==='restricted'?grants.has(`${kind}:${id}`):visibility==='project'?scope===projectId:true);
 return context.resources.every(row=>visible('resource',row.id,row.visibility,context.projectId)&&(!row.note_id||visible('note',row.note_id,row.note_visibility,row.note_project_id)));
}
export async function authorizeCanvasResource(client,resourceId,projectId,actor){
 if(!actor.permissions.has('resources.view'))fail(403,'RESOURCE_VIEW_REQUIRED','Resource view permission required');
 const before=await getResourceContext(resourceId,client);
 const bindings=before&&!before.invalid&&resourceBindings(before.resources);
 if(!bindings)fail(404,'CANVAS_RESOURCE_UNAVAILABLE','Resource context is unavailable');
 const ids=before.resources.map(r=>r.id),notes=[...new Set(before.resources.map(r=>r.note_id).filter(Boolean))];
 await client.query('SELECT id FROM resources WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[ids]);
 if(notes.length)await client.query('SELECT id FROM notes WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE',[notes]);
 const current=await getResourceContext(resourceId,client);
 if(!current||current.invalid||JSON.stringify(bindings)!==JSON.stringify(resourceBindings(current.resources)))fail(409,'CANVAS_RESOURCE_CHANGED','Resource context changed; refresh before retrying');
 const grantRows=(await client.query("SELECT entity_type,entity_id FROM record_access_grants WHERE user_id=$1 AND ((entity_type='resource' AND entity_id=ANY($2::uuid[])) OR (entity_type='note' AND entity_id=ANY($3::uuid[]))) ORDER BY entity_type,entity_id FOR SHARE",[actor.userId,ids,notes])).rows;
 if(!canvasContextAllowed(current,projectId,actor,new Set(grantRows.map(g=>`${g.entity_type}:${g.entity_id}`))))fail(404,'CANVAS_RESOURCE_UNAVAILABLE','Resource is unavailable for this canvas');
}
export async function assertRequirementRemovable(client,id){
 const linked=(await client.query(`SELECT EXISTS(SELECT 1 FROM project_tasks WHERE requirement_id=$1 UNION ALL SELECT 1 FROM project_experiments WHERE requirement_id=$1 UNION ALL SELECT 1 FROM project_bom_items WHERE requirement_id=$1 UNION ALL SELECT 1 FROM item_custody_records WHERE requirement_id=$1) AS linked`,[id])).rows[0];
 if(linked?.linked)fail(409,'PROJECT_REQUIREMENT_LINKED','This requirement has work or custody references; retain it and review those links instead of deleting it');
}
