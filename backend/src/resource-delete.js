import {requireResourceEditor} from './middleware/resource-access.js';
import {writeAuditLog} from './middleware/audit.js';
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};

export function createResourceDeleter({authorize=requireResourceEditor,audit=writeAuditLog}={}){
 return async function deleteResourceRecord(client,id,user,{deviceId=null,request={user}}={}){
  const resource=(await client.query('SELECT * FROM resources WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!resource){
   const deleted=await client.query("SELECT 1 FROM sync_tombstones WHERE entity_type='resource' AND entity_id=$1",[id]);
   if(deleted.rowCount)return {id,deleted:true,already_deleted:true};
   fail(503,'RESOURCE_DELETE_WAITING_FOR_CREATE','Resource creation has not reached the server; deletion remains pending');
  }
  const access=await authorize(id,user);
  if(!access.ok)fail(access.status,access.error.code,access.error.message);
  // The parent row lock also fences a concurrent child INSERT through its FK.
  const children=await client.query('SELECT 1 FROM resources WHERE parent_resource_id=$1 LIMIT 1',[id]);
  if(children.rowCount)fail(409,'RESOURCE_FOLDER_NOT_EMPTY','Move or remove the folder contents first; no child resources have been deleted');
  await client.query("DELETE FROM record_access_grants WHERE entity_type='resource' AND entity_id=$1",[id]);
  await client.query('DELETE FROM resources WHERE id=$1',[id]);
  const projectId=access.context?.projectId??resource.project_id??null;
  await client.query("INSERT INTO sync_tombstones(entity_type,entity_id,project_id,item_id,note_id) VALUES('resource',$1,$2,$3,$4) ON CONFLICT(entity_type,entity_id) DO UPDATE SET deleted_at=now(),project_id=EXCLUDED.project_id,item_id=EXCLUDED.item_id,note_id=EXCLUDED.note_id",[id,projectId,resource.item_id??null,resource.note_id??null]);
  const result={id,deleted:true};
  await audit({req:request,actorUserId:user.userId,action:'sync:delete',entityType:'resource',entityId:id,oldValue:resource,newValue:result,deviceId,client,required:true,metadata:{project_id:projectId}});
  return result;
 };
}
export const deleteResourceRecord=createResourceDeleter();
