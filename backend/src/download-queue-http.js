import {createDownloadJob} from './download-queue-create.js';
import {authorizeDownloadControl,downloadUuid} from './download-job-control.js';
import {writeAuditLog} from './middleware/audit.js';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export function queueHttpPayload(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['resource_id','quality','scheduled_for','priority'].includes(k)))fail(400,'INVALID_DOWNLOAD_REQUEST','Invalid download request');
  const resource_id=downloadUuid(body.resource_id),quality=body.quality??null,priority=body.priority??0;
  if(quality!==null&&!['best','1080p','720p','480p'].includes(quality))fail(400,'INVALID_DOWNLOAD_QUALITY','Invalid download quality');
  if(!Number.isInteger(priority)||priority< -100||priority>100)fail(400,'INVALID_DOWNLOAD_PRIORITY','Invalid download priority');
  let scheduled_for=body.scheduled_for??null;
  if(scheduled_for!==null){
    if(typeof scheduled_for!=='string'||!Number.isFinite(Date.parse(scheduled_for)))fail(400,'INVALID_DOWNLOAD_SCHEDULE','Invalid scheduled time');
    scheduled_for=new Date(scheduled_for).toISOString();
  }
  return{resource_id,quality,scheduled_for,priority};
}
export function sameQueueReceipt(prior,key,payload,userId){
  return prior.user_id===userId&&prior.device_id==='download-queue-http'&&prior.entity_type==='resource_download_job'&&prior.entity_id===key&&prior.operation==='create'
    &&['resource_id','quality','scheduled_for','priority'].every(k=>prior.payload_json?.[k]===payload[k])
    &&Object.keys(prior.payload_json??{}).length===4;
}
export async function enqueueDownloadHttp(pool,req){
  const key=downloadUuid(req.get('Idempotency-Key')),payload=queueHttpPayload(req.body);
  // Replays require current access too: a receipt is not a permission grant.
  await authorizeDownloadControl(payload.resource_id,req.user);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+key]);
    const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1',[key])).rows[0];
    let result;
    if(prior){
      if(!sameQueueReceipt(prior,key,payload,req.user.userId))fail(409,'IDEMPOTENCY_MISMATCH','Key belongs to another download request');
      result=prior.response_json;
    }else{
      result=await createDownloadJob(client,{change_id:key,operation:'create',entity_id:key,payload},req.user);
      // An active job may already exist; returning it is not another creation.
      if(result.id===key)await writeAuditLog({req,client,required:true,action:'CREATE',entityType:'resource_download_job',entityId:result.id,newValue:result,metadata:{change_id:key}});
      await client.query(`INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status)
        VALUES($1,'download-queue-http',$2,'resource_download_job',$1,'create',$3,$4,201)`,[key,req.user.userId,payload,result]);
    }
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
