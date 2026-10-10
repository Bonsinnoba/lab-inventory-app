import { getUserPermissions } from './middleware/permissions.js';
import { requireResourceEditor } from './middleware/resource-access.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const uuid=value=>{const text=String(value??'').replaceAll('-','').toLowerCase();if(!/^[0-9a-f]{32}$/.test(text))fail(400,'INVALID_DOWNLOAD_ID','Invalid download UUID');return `${text.slice(0,8)}-${text.slice(8,12)}-${text.slice(12,16)}-${text.slice(16,20)}-${text.slice(20)}`;};
export async function createDownloadJob(client,change,user){
  if(change.operation!=='create')fail(400,'UNSUPPORTED_SYNC_OPERATION','Download queue requests support create only');
  const payload=change.payload||{},resourceId=uuid(payload.resource_id||payload.resourceId),jobId=uuid(change.entity_id);
  if(!(await getUserPermissions(user.userId,user.role)).has('resources.edit'))fail(403,'PERMISSION_DENIED','Permission required: resources.edit');
  const access=await requireResourceEditor(resourceId,user);
  if(!access.ok)fail(access.status,'RESOURCE_ACCESS_DENIED','Resource edit access required');
  // Shared by HTTP and sync: lock the same resource before active-job lookup.
  const resource=(await client.query('SELECT * FROM resources WHERE id=$1 FOR UPDATE',[resourceId])).rows[0];
  if(!resource)fail(404,'RESOURCE_NOT_FOUND','Resource not found');
  if(resource.kind!=='link'||!resource.url)fail(400,'INVALID_DOWNLOAD_RESOURCE','Only URL resources can be downloaded');
  const existing=(await client.query("SELECT * FROM resource_download_jobs WHERE resource_id=$1 AND status IN ('queued','scheduled','downloading','paused') ORDER BY created_at,id LIMIT 1",[resourceId])).rows[0];
  if(existing)return existing;
  if(resource.local_media_path)fail(409,'MEDIA_ALREADY_DOWNLOADED','This resource already has a server video copy');
  const settings=(await client.query('SELECT default_quality,max_retries FROM media_download_settings WHERE id=1')).rows[0];
  const quality=payload.quality??settings?.default_quality??'720p';
  if(!['best','1080p','720p','480p'].includes(quality))fail(400,'INVALID_DOWNLOAD_QUALITY','Invalid download quality');
  const schedule=payload.scheduled_for??null;
  if(schedule!==null&&(typeof schedule!=='string'||!Number.isFinite(Date.parse(schedule))))fail(400,'INVALID_DOWNLOAD_SCHEDULE','Invalid scheduled time');
  const priority=payload.priority??0;
  if(!Number.isInteger(priority)||priority< -100||priority>100)fail(400,'INVALID_DOWNLOAD_PRIORITY','Invalid priority');
  return (await client.query(`INSERT INTO resource_download_jobs(id,resource_id,requested_by,status,quality,scheduled_for,priority,max_attempts)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[jobId,resourceId,user.userId,schedule?'scheduled':'queued',quality,schedule,priority,1+Math.max(0,Math.min(4,Number(settings?.max_retries)||0))])).rows[0];
}
