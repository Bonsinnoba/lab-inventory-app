import { getUserPermissions } from './middleware/permissions.js';
import { requireResourceEditor } from './middleware/resource-access.js';
import { writeAuditLog } from './middleware/audit.js';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export function downloadUuid(value){
  const s=String(value??'').replaceAll('-','').toLowerCase();
  if(!/^[0-9a-f]{32}$/.test(s))fail(400,'INVALID_DOWNLOAD_ID','Invalid download UUID');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
export async function authorizeDownloadControl(resourceId,user){
  resourceId=downloadUuid(resourceId);
  if(!(await getUserPermissions(user.userId,user.role)).has('resources.edit'))fail(403,'PERMISSION_DENIED','Permission required: resources.edit');
  if(!(await requireResourceEditor(resourceId,user)).ok)fail(403,'RESOURCE_ACCESS_DENIED','Resource edit access required');
}
export function validateDownloadControl(payload,operation){
  if(!payload||!Number.isSafeInteger(payload.expected_version)||payload.expected_version<0)fail(400,'EXPECTED_VERSION_REQUIRED','Refresh the download before changing it');
  if(!['edit','start','pause','cancel','remove'].includes(payload.action)||operation!==(payload.action==='remove'?'delete':'update'))fail(400,'INVALID_DOWNLOAD_CONTROL','Invalid download action');
  const patch=payload.patch??{};
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!['quality','scheduled_for','priority','status'].includes(k)))fail(400,'INVALID_DOWNLOAD_CONTROL','Invalid download edit');
  if(payload.action!=='edit'&&Object.keys(patch).length)fail(400,'INVALID_DOWNLOAD_CONTROL','Only edit actions accept a patch');
  if(patch.quality!==undefined&&!['best','1080p','720p','480p'].includes(patch.quality))fail(400,'INVALID_DOWNLOAD_QUALITY','Invalid quality');
  if(patch.priority!==undefined&&(!Number.isInteger(patch.priority)||patch.priority< -100||patch.priority>100))fail(400,'INVALID_DOWNLOAD_PRIORITY','Invalid priority');
  if(patch.scheduled_for!==undefined&&patch.scheduled_for!==null&&(typeof patch.scheduled_for!=='string'||!Number.isFinite(Date.parse(patch.scheduled_for))))fail(400,'INVALID_DOWNLOAD_SCHEDULE','Invalid schedule');
  if(patch.status!==undefined&&!['queued','scheduled'].includes(patch.status))fail(400,'INVALID_DOWNLOAD_CONTROL','Invalid queue status');
  return patch;
}

// Caller owns transaction and idempotency receipt. Every writer locks resource,
// then job; the worker uses the same order when publishing completed media.
export async function applyDownloadControl(client,change,user){
  const id=downloadUuid(change.entity_id),p=change.payload,patch=validateDownloadControl(p,change.operation);
  const resourceId=downloadUuid(p.resource_id);
  await authorizeDownloadControl(resourceId,user);
  const resource=(await client.query('SELECT * FROM resources WHERE id=$1 FOR UPDATE',[resourceId])).rows[0];
  const job=(await client.query('SELECT * FROM resource_download_jobs WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!resource||!job||job.resource_id!==resourceId)fail(409,'SYNC_CONFLICT','Download no longer exists. Refresh and review the queue.');
  if(job.control_version!==p.expected_version)fail(409,'SYNC_CONFLICT','Download controls changed on another device. Review before reapplying.');
  let result;
  // Completion wins over late cancellation: never delete a completed resource.
  if(['pause','cancel'].includes(p.action)&&job.status==='completed'){
    result={...job,control_outcome:'already_completed'};
  }else if(p.action==='remove'){
    if(job.status==='downloading')fail(409,'SYNC_CONFLICT','Wait for the worker to finish pausing or cancelling before removal');
    await client.query('DELETE FROM resource_download_jobs WHERE id=$1',[id]);
    result={id,resource_id:resourceId,deleted:true,control_version:job.control_version+1};
  }else{
    let status=job.status,quality=job.quality,schedule=job.scheduled_for,priority=job.priority;
    let stop=job.stop_requested_status,cancel=job.cancel_requested;
    if(['pause','cancel'].includes(p.action)){
      const target=p.action==='pause'?'paused':'cancelled';
      if(p.action==='pause'&&!['queued','scheduled','downloading','paused'].includes(status))fail(409,'SYNC_CONFLICT','This download can no longer be paused');
      stop=status==='downloading'?target:null;cancel=target==='cancelled'||status==='downloading';
      if(status!=='downloading')status=target;
    }else{
      if(status==='downloading'||status==='completed')fail(409,'SYNC_CONFLICT','Download is running or completed. Review its current state.');
      if(p.action==='start'){
        const other=(await client.query("SELECT id FROM resource_download_jobs WHERE resource_id=$1 AND id<>$2 AND status IN ('queued','scheduled','downloading','paused') LIMIT 1",[resourceId,id])).rows[0];
        if(resource.local_media_path||other)fail(409,'SYNC_CONFLICT','Resource already has media or another active download');
        status='queued';schedule=new Date();
      }else{
        if(!['queued','scheduled','paused'].includes(status))fail(409,'SYNC_CONFLICT','Only waiting or paused downloads can be edited');
        quality=patch.quality??quality;priority=patch.priority??priority;
        if(Object.hasOwn(patch,'scheduled_for'))schedule=patch.scheduled_for;
        status=patch.status??(Object.hasOwn(patch,'scheduled_for')?(schedule?'scheduled':'queued'):status);
        if(status==='scheduled'&&!schedule)status='queued';
      }
      stop=null;cancel=false;
    }
    result=(await client.query(`UPDATE resource_download_jobs SET status=$2,quality=$3,scheduled_for=$4,priority=$5,
      stop_requested_status=$6,cancel_requested=$7,control_version=control_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING *`,
      [id,status,quality,schedule,priority,stop,cancel])).rows[0];
  }
  await writeAuditLog({req:{user},client,required:true,action:result.deleted?'DELETE':'UPDATE',entityType:'resource_download_job',entityId:id,oldValue:job,newValue:result,metadata:{change_id:change.change_id,action:p.action}});
  return result;
}

export async function controlDownloadHttp(pool,req,action,operation,patch={}){
  const key=downloadUuid(req.get('Idempotency-Key')),id=downloadUuid(req.params.id);
  const payload={action,patch,resource_id:downloadUuid(req.body?.resource_id),expected_version:req.body?.expected_version};
  validateDownloadControl(payload,operation);
  await authorizeDownloadControl(payload.resource_id,req.user);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+key]);
    const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1',[key])).rows[0];
    let result;
    if(prior){
      const same=(await client.query('SELECT $1::jsonb=$2::jsonb AS same',[prior.payload_json,payload])).rows[0].same;
      if(prior.user_id!==req.user.userId||prior.device_id!=='download-control-http'||prior.entity_type!=='resource_download_job'||prior.entity_id!==id||prior.operation!==operation||!same)fail(409,'IDEMPOTENCY_MISMATCH','Key belongs to another download action');
      result=prior.response_json;
    }else{
      result=await applyDownloadControl(client,{change_id:key,entity_id:id,operation,payload},req.user);
      await client.query(`INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status)
        VALUES($1,'download-control-http',$2,'resource_download_job',$3,$4,$5,$6,200)`,[key,req.user.userId,id,operation,payload,result]);
    }
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
