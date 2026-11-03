import {pool} from './db.js';
import {catalogUuid} from './catalog-sync.js';
import {getUserPermissions} from './middleware/permissions.js';
import {writeAuditLog} from './middleware/audit.js';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const values={member:['lead','member','observer'],grant:['view','edit']};

// The project lock serializes membership/grant management for this project.
// Account/override locks make cached middleware roles insufficient authority.
async function authority(client,projectId,actorId,kind){
 const project=(await client.query('SELECT id,owner_id,visibility FROM projects WHERE id=$1 FOR UPDATE',[projectId])).rows[0];
 if(!project)fail(404,'PROJECT_NOT_FOUND','Project not found');
 const actor=(await client.query('SELECT role,is_active FROM users WHERE id=$1 FOR SHARE',[actorId])).rows[0];
 if(!actor?.is_active)fail(403,'ACCOUNT_DISABLED','Account is inactive');
 const permissions=await getUserPermissions(actorId,actor.role,{client,lock:true});
 if(!permissions.has('projects.edit'))fail(403,'PERMISSION_DENIED','Project edit permission required');
 if(kind==='member'){
  if(actor.role!=='admin')fail(403,'PROJECT_MEMBERSHIP_ADMIN_REQUIRED','Only a current administrator can manage project membership');
 }else{
  if(project.visibility!=='restricted')fail(409,'PROJECT_GRANTS_NOT_RESTRICTED','Access grants are available only for restricted projects');
  const member=(await client.query('SELECT member_role FROM project_members WHERE project_id=$1 AND user_id=$2 FOR SHARE',[projectId,actorId])).rows[0];
  if(actor.role!=='admin'&&project.owner_id!==actorId&&member?.member_role!=='lead')fail(403,'PROJECT_GRANT_MANAGER_REQUIRED','Only the project owner, a lead, or an administrator can manage grants');
 }
}

export async function projectAccessGrantsRead(req,res,next){
 let client;
 try{
  const projectId=catalogUuid(req.params.id);client=await pool.connect();await client.query('BEGIN');
  await authority(client,projectId,req.user.userId,'grant');
  const rows=await client.query("SELECT g.user_id,g.access_level,g.created_at,g.created_by,u.username FROM record_access_grants g JOIN users u ON u.id=g.user_id WHERE g.entity_type='project' AND g.entity_id=$1 ORDER BY u.username",[projectId]);
  await client.query('COMMIT');res.setHeader('Cache-Control','no-store');res.json(rows.rows);
 }catch(error){
  if(client)await client.query('ROLLBACK').catch(()=>{});
  if(error.status)return res.status(error.status).json({error:{code:error.code,message:error.message}});
  next(error);
 }finally{client?.release();}
}

export function projectAccessHttpMutation(kind,operation){
 if(!values[kind]||!['set','delete'].includes(operation))throw Error('Unsupported project access mutation');
 return async(req,res,next)=>{
  let client;
  try{
   const body=req.body||{},key=catalogUuid(req.get('Idempotency-Key')),projectId=catalogUuid(req.params.id);
   const target=catalogUuid(kind==='member'&&operation==='set'?body.user_id:req.params.userId);
   const valueField=kind==='member'?'member_role':'access_level';
   if(!Object.hasOwn(body,'expected_value')||!(body.expected_value===null||values[kind].includes(body.expected_value))||(operation==='delete'&&body.expected_value===null))fail(400,'PROJECT_ACCESS_BASE_REQUIRED','Supply the access value shown before this change; null means no existing entry');
   if(operation==='set'&&!values[kind].includes(body[valueField]))fail(400,'PROJECT_ACCESS_VALUE_INVALID','Invalid project access value');
   const payload={target_user_id:target,expected_value:body.expected_value,...(operation==='set'?{value:body[valueField]}:{})};
   const entityType=kind==='member'?'project_member':'project_access_grant';
   client=await pool.connect();await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+key]);
   await authority(client,projectId,req.user.userId,kind);
   const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1 FOR UPDATE',[key])).rows[0];
   let result,status=operation==='delete'?204:kind==='member'?201:200;
   if(prior){
    const same=(await client.query('SELECT $1::jsonb=$2::jsonb AS same',[prior.payload_json,payload])).rows[0].same;
    if(prior.user_id!==req.user.userId||prior.device_id!=='project-access-http'||prior.entity_type!==entityType||prior.entity_id!==projectId||prior.operation!==operation||!same)fail(409,'IDEMPOTENCY_MISMATCH','Retry key belongs to another access change');
    result=prior.response_json;status=prior.response_status;
   }else{
    const targetRow=(await client.query('SELECT id,username,role,is_active FROM users WHERE id=$1 FOR SHARE',[target])).rows[0];
    if(operation==='set'&&!targetRow?.is_active)fail(400,'PROJECT_ACCESS_TARGET_INACTIVE','Select an active user');
    const before=(await client.query(kind==='member'?'SELECT * FROM project_members WHERE project_id=$1 AND user_id=$2 FOR UPDATE':"SELECT * FROM record_access_grants WHERE entity_type='project' AND entity_id=$1 AND user_id=$2 FOR UPDATE",[projectId,target])).rows[0];
    if((before?.[valueField]??null)!==payload.expected_value)fail(409,'PROJECT_ACCESS_CHANGED','Project access changed; refresh and review before applying this change');
    if(operation==='delete'){
     await client.query(kind==='member'?'DELETE FROM project_members WHERE project_id=$1 AND user_id=$2':"DELETE FROM record_access_grants WHERE entity_type='project' AND entity_id=$1 AND user_id=$2",[projectId,target]);result=null;
    }else if(kind==='member'){
     const row=(await client.query('INSERT INTO project_members(project_id,user_id,member_role) VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET member_role=EXCLUDED.member_role RETURNING *',[projectId,target,payload.value])).rows[0];
     result={...row,username:targetRow.username,role:targetRow.role};
    }else result=(await client.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('project',$1,$2,$3,$4) ON CONFLICT(entity_type,entity_id,user_id) DO UPDATE SET access_level=EXCLUDED.access_level,created_by=EXCLUDED.created_by RETURNING entity_type,entity_id,user_id,access_level,created_at,created_by",[projectId,target,payload.value,req.user.userId])).rows[0];
    if(operation==='set'&&!result)fail(500,'PROJECT_ACCESS_CONFIRMATION_MISSING','Database did not confirm the access entry');
    await writeAuditLog({req,action:operation==='delete'?'DELETE':'UPDATE',entityType,entityId:kind==='member'?target:projectId,oldValue:before??null,newValue:result,metadata:{project_id:projectId,target_user_id:target,change_id:key},client,required:true});
    // Public DELETE is 204, but receipt.response_json is NOT NULL. Keep an
    // explicit deletion acknowledgement rather than attempting to insert SQL NULL.
    const receiptResult=operation==='delete'?{deleted:true,project_id:projectId,user_id:target}:result;
    await client.query("INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,'project-access-http',$2,$3,$4,$5,$6,$7,$8)",[key,req.user.userId,entityType,projectId,operation,payload,receiptResult,status]);
   }
   await client.query('COMMIT');if(status===204)res.status(204).send();else res.status(status).json(result);
  }catch(error){
   if(client)await client.query('ROLLBACK').catch(()=>{});
   if(error.status)return res.status(error.status).json({error:{code:error.code,message:error.message}});
   next(error);
  }finally{client?.release();}
 };
}
