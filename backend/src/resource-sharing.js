import {pool} from './db.js';
import {currentResourceActor} from './resource-sync-actor.js';
import {getUserPermissions} from './middleware/permissions.js';
import {requireResourceEditor} from './middleware/resource-access.js';
import {canManageEntityGrants,isVisibility} from './middleware/visibility.js';
import {writeAuditLog} from './middleware/audit.js';
import {lockResourceScope} from './resource-scope-lock.js';
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
const uuid=value=>{if(typeof value!=='string'||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value))fail(400,'INVALID_RESOURCE_ID','Invalid resource or account identity');return value.toLowerCase();};
export async function lockResourceSharingScope(client,id,user){
 id=uuid(id);const current=await currentResourceActor(client,user);const permissions=await getUserPermissions(current.userId,current.role,{client,lock:true});
 for(const permission of ['resources.view','resources.edit'])if(!permissions.has(permission))fail(403,'PERMISSION_DENIED',`Permission required: ${permission}`);
 const context=await lockResourceScope(client,id,current);
 return{user:current,context};
}
const advance='UPDATE resources SET updated_at=GREATEST(date_trunc(\'milliseconds\',clock_timestamp()),date_trunc(\'milliseconds\',updated_at)+interval \'1 millisecond\') WHERE id=$1 RETURNING *';
export async function changeResourceVisibility(client,id,value,user,req={}){
 if(!isVisibility(value))fail(400,'INVALID_VISIBILITY','Visibility must be lab, project or restricted');id=uuid(id);const locked=await lockResourceSharingScope(client,id,user);const access=await requireResourceEditor(id,locked.user,client);if(!access.ok)fail(access.status,access.error?.code||'RESOURCE_EDIT_REQUIRED',access.error?.message||'Resource edit access required');if(value==='project'&&!locked.context.projectId)fail(400,'RESOURCE_PROJECT_REQUIRED','Project visibility requires a project-owned parent');
 const old=(await client.query('SELECT * FROM resources WHERE id=$1',[id])).rows[0];if(old.visibility===value)return old;
 const updated=(await client.query("UPDATE resources SET visibility=$1,updated_at=GREATEST(date_trunc('milliseconds',clock_timestamp()),date_trunc('milliseconds',updated_at)+interval '1 millisecond') WHERE id=$2 RETURNING *",[value,id])).rows[0];
 if(value==='restricted')await client.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('resource',$1,$2,'edit',$2) ON CONFLICT(entity_type,entity_id,user_id) DO UPDATE SET access_level='edit'",[id,locked.user.userId]);
 if(old.visibility==='restricted'&&value!=='restricted')await client.query("DELETE FROM record_access_grants WHERE entity_type='resource' AND entity_id=$1",[id]);
 await writeAuditLog({req,actorUserId:locked.user.userId,action:'UPDATE',entityType:'resource',entityId:id,oldValue:old,newValue:updated,metadata:{visibility_change:true,project_id:locked.context.projectId},client,required:true});return updated;
}
export async function changeResourceGrant(client,id,targetId,level,user,req={}){
 id=uuid(id);targetId=uuid(targetId);if(level!==null&&!['view','edit'].includes(level))fail(400,'INVALID_ACCESS_LEVEL','Access must be view or edit');const locked=await lockResourceSharingScope(client,id,user);
 if(locked.context.resource.visibility!=='restricted')fail(409,'RESOURCE_NOT_RESTRICTED','Access grants apply only to restricted resources');if(!await canManageEntityGrants({projectId:locked.context.projectId,user:locked.user,client}))fail(403,'RESOURCE_GRANT_MANAGER_REQUIRED','Only an administrator or project lead may manage access grants');
 if(level!==null&&!((await client.query('SELECT id FROM users WHERE id=$1 AND is_active=TRUE FOR SHARE',[targetId])).rowCount))fail(400,'GRANT_TARGET_INACTIVE','The target account must be active');
 const old=(await client.query("SELECT entity_type,entity_id,user_id,access_level,created_at,created_by FROM record_access_grants WHERE entity_type='resource' AND entity_id=$1 AND user_id=$2 FOR UPDATE",[id,targetId])).rows[0]||null;
 // Replaying the same desired value does not duplicate an audit or revision.
 if(old?.access_level===level||(!old&&level===null))return old;
 const result=level===null?(await client.query("DELETE FROM record_access_grants WHERE entity_type='resource' AND entity_id=$1 AND user_id=$2 RETURNING user_id,access_level",[id,targetId])).rows[0]:(await client.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('resource',$1,$2,$3,$4) ON CONFLICT(entity_type,entity_id,user_id) DO UPDATE SET access_level=EXCLUDED.access_level,created_by=EXCLUDED.created_by RETURNING entity_type,entity_id,user_id,access_level,created_at,created_by",[id,targetId,level,locked.user.userId])).rows[0];
 await client.query(advance,[id]);await writeAuditLog({req,actorUserId:locked.user.userId,action:level===null?'DELETE':'UPDATE',entityType:'resource_access_grant',entityId:id,oldValue:old,newValue:level===null?null:result,metadata:{resource_id:id,project_id:locked.context.projectId,target_user_id:targetId},client,required:true});return result;
}
export async function resourceSharingTransaction(work){const client=await pool.connect();try{await client.query('BEGIN');const value=await work(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}}
