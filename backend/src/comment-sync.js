import { pool } from './db.js';
import { catalogUuid } from './catalog-sync.js';
import { getProjectAccess } from './middleware/project-access.js';
import { getUserPermissions } from './middleware/permissions.js';
import { visibilityReadSql } from './middleware/visibility.js';
import { writeAuditLog } from './middleware/audit.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};

export async function authorizeComment(project,user,edit){
  const permissions=await getUserPermissions(user.userId,user.role);
  if(!permissions.has('projects.view')||edit&&!permissions.has('projects.edit'))fail(403,'PERMISSION_DENIED','Project permission required');
  const access=await getProjectAccess(project,user);
  if(access.access==='none'||edit&&!['edit','admin'].includes(access.access))fail(403,'PROJECT_ACCESS_REQUIRED','Current project access is required');
}
export async function readComments(user){
  if(!(await getUserPermissions(user.userId,user.role)).has('projects.view'))fail(403,'PERMISSION_DENIED','projects.view required');
  const projects=await pool.query(`SELECT p.id FROM projects p WHERE ${visibilityReadSql({alias:'p',entityType:'project',projectIdExpression:'p.id',userIdParameter:'$1',roleParameter:'$2'})}`,[user.userId,user.role]);
  const visible=projects.rows.map(r=>r.id);
  const rows=await pool.query('SELECT c.*,u.username AS author_username FROM project_comments c LEFT JOIN users u ON u.id=c.author_id WHERE c.project_id=ANY($1::uuid[]) ORDER BY c.created_at,c.id',[visible]);
  return {records:rows.rows,visible_project_ids:visible,snapshot_complete:true};
}
export async function applyCommentChange(client,change,user){
  const op=change.operation,p=change.payload,record=p?.record;
  if(!['create','delete'].includes(op)||!record)fail(400,'INVALID_COMMENT','Comments support create and delete only');
  const id=catalogUuid(change.entity_id),project=catalogUuid(record.project_id);
  if(catalogUuid(record.id)!==id)fail(400,'INVALID_SYNC_ID','Comment IDs disagree');
  await authorizeComment(project,user,true);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['comment:'+id]);
  if(!(await client.query('SELECT 1 FROM projects WHERE id=$1 FOR KEY SHARE',[project])).rowCount)fail(409,'COMMENT_PARENT_MISSING','Sync the project first');
  if(p.depends_on&&!(await client.query("SELECT 1 FROM sync_idempotency WHERE change_id=$1 AND user_id=$2 AND entity_type='project_comment' AND entity_id=$3",[p.depends_on,user.userId,id])).rowCount)fail(409,'SYNC_DEPENDENCY_PENDING','Resolve the preceding comment intent first');
  const old=(await client.query('SELECT * FROM project_comments WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(old&&old.project_id!==project)fail(409,'COMMENT_PARENT_MISMATCH','Comment cannot change project');
  const deleted=(await client.query("SELECT 1 FROM sync_tombstones WHERE entity_type='project_comment' AND entity_id=$1",[id])).rowCount;
  let result;
  if(op==='delete'){
    if(!old){if(deleted)return{id,deleted:true};fail(409,'COMMENT_NOT_FOUND','Comment no longer exists');}
    if(user.role!=='admin'&&old.author_id!==user.userId)fail(403,'COMMENT_AUTHOR_REQUIRED','Only the author or an administrator can delete this comment');
    await client.query('DELETE FROM project_comments WHERE id=$1',[id]);result={id,deleted:true};
  }else{
    if(old||deleted)fail(409,'SYNC_CONFLICT','Comment identity already exists or was deleted');
    if(typeof record.body!=='string'||!record.body.trim()||record.body.length>5000)fail(400,'INVALID_COMMENT','A comment must contain 1–5000 characters');
    result=(await client.query('INSERT INTO project_comments(id,project_id,author_id,body) VALUES($1,$2,$3,$4) RETURNING *',[id,project,user.userId,record.body.trim()])).rows[0];
    const actor=(await client.query('SELECT username FROM users WHERE id=$1',[user.userId])).rows[0];
    result.author_username=actor.username;
    const members=await client.query('SELECT u.id,u.role FROM project_members m JOIN users u ON u.id=m.user_id WHERE m.project_id=$1 AND u.id<>$2 AND u.is_active',[project,user.userId]);
    for(const member of members.rows){
      if((await getProjectAccess(project,{userId:member.id,role:member.role})).access==='none')continue;
      await client.query("INSERT INTO notifications(user_id,type,title,body,entity_type,entity_id,metadata) VALUES($1,'project_comment','New project comment',$2,'project_comment',$3,$4)",[member.id,`${actor.username} commented on a project.`,id,{project_id:project}]);
    }
  }
  await writeAuditLog({req:{user},client,required:true,action:op.toUpperCase(),entityType:'project_comment',entityId:id,oldValue:old??null,newValue:result,metadata:{project_id:project,change_id:change.change_id}});
  return result;
}
export function commentHttpMutation(operation){return async(req,res,next)=>{
  let client;
  try{
    const key=catalogUuid(req.get('Idempotency-Key')),project=catalogUuid(req.params.projectId),id=catalogUuid(operation==='create'?req.body?.id:req.params.commentId);
    await authorizeComment(project,req.user,true);
    const payload={record:{id,project_id:project,...(operation==='create'?{body:req.body?.body}:{})},depends_on:null};
    client=await pool.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+key]);
    const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1',[key])).rows[0];let result;
    if(prior){
      const same=(await client.query('SELECT $1::jsonb=$2::jsonb AS same',[prior.payload_json,payload])).rows[0].same;
      if(prior.user_id!==req.user.userId||prior.entity_type!=='project_comment'||prior.entity_id!==id||prior.operation!==operation||prior.device_id!=='comment-http'||!same)fail(409,'IDEMPOTENCY_MISMATCH','Key belongs to another comment intent');
      // Comments are immutable; current project access was rechecked above.
      result=prior.response_json;
    }else{
      result=await applyCommentChange(client,{change_id:key,entity_id:id,operation,payload},req.user);
      await client.query("INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,'comment-http',$2,'project_comment',$3,$4,$5,$6,200)",[key,req.user.userId,id,operation,payload,result]);
    }
    await client.query('COMMIT');res.status(operation==='create'?201:200).json(result);
  }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});if(error.status)return res.status(error.status).json({error:{code:error.code,message:error.message}});next(error);}finally{client?.release();}
};}
