import { getUserPermissions } from './middleware/permissions.js';
import { writeAuditLog } from './middleware/audit.js';
function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
export const settingFields=['enabled','mode','window_start','window_end','concurrent_downloads','default_quality','max_retries'];
export function downloadSettingsPayload(row){
  return {...Object.fromEntries(settingFields.map(key=>[key,row[key]])),window_start:String(row.window_start).slice(0,5),window_end:String(row.window_end).slice(0,5),sync_version:Number(row.sync_version),updated_at:row.updated_at};
}
export function validateDownloadSettings(patch){
  if(!patch||typeof patch!=='object'||Array.isArray(patch))fail(400,'INVALID_DOWNLOAD_SETTINGS','Settings must be an object');
  for(const key of Object.keys(patch))if(!settingFields.includes(key))fail(400,'INVALID_DOWNLOAD_SETTINGS',`Unknown setting: ${key}`);
  for(const [key,value] of Object.entries(patch)){
    const valid=key==='enabled'?typeof value==='boolean':key==='mode'?['manual','scheduled','always'].includes(value):
      key==='default_quality'?['best','1080p','720p','480p'].includes(value):
      ['window_start','window_end'].includes(key)?typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value):
      Number.isInteger(value)&&value>=(key==='max_retries'?0:1)&&value<=(key==='max_retries'?4:3);
    if(!valid)fail(400,'INVALID_DOWNLOAD_SETTINGS',`Invalid ${key}`);
  }
}
export async function applyDownloadSettings(client,change,user){
  if(change.operation!=='update'||change.entity_id!=='global')fail(400,'INVALID_DOWNLOAD_SETTINGS','Invalid settings intent');
  if(!(await getUserPermissions(user.userId,user.role)).has('resources.edit'))fail(403,'PERMISSION_DENIED','Permission required: resources.edit');
  const payload=change.payload;validateDownloadSettings(payload?.patch);
  if(!Number.isSafeInteger(payload.expected_version)||payload.expected_version<0)fail(400,'EXPECTED_VERSION_REQUIRED','Download settings require an expected version');
  let expected=payload.expected_version;
  if(payload.depends_on){
    const prior=(await client.query("SELECT response_json FROM sync_idempotency WHERE change_id=$1 AND user_id=$2 AND device_id=$3 AND entity_type='media_download_settings' AND entity_id='global' AND operation='update'",[payload.depends_on,user.userId,change.__device_id])).rows[0];
    if(!prior)fail(409,'SYNC_DEPENDENCY_PENDING','Resolve the earlier settings change first');
    expected=Number(prior.response_json.sync_version);
  }
  const row=(await client.query('SELECT * FROM media_download_settings WHERE id=1 FOR UPDATE')).rows[0];
  if(!row)fail(409,'SETTINGS_NOT_INITIALIZED','Download settings have not been initialized');
  const current=downloadSettingsPayload(row);
  if(current.sync_version!==expected)fail(409,'SYNC_CONFLICT','Download settings changed on another device. Review the server settings before reapplying.');
  const next={...current,...payload.patch};
  const result=(await client.query(`UPDATE media_download_settings SET enabled=$1,mode=$2,window_start=$3::time,window_end=$4::time,
    concurrent_downloads=$5,default_quality=$6,max_retries=$7,updated_by=$8,updated_at=CURRENT_TIMESTAMP WHERE id=1 RETURNING *`,
    [...settingFields.map(key=>next[key]),user.userId])).rows[0];
  const saved=downloadSettingsPayload(result);
  await writeAuditLog({req:{user},client,required:true,action:'UPDATE',entityType:'media_download_settings',entityId:null,oldValue:current,newValue:saved,metadata:{change_id:change.change_id}});
  return saved;
}

export async function updateDownloadSettingsHttp(pool,req){
  const key=req.get('Idempotency-Key');
  if(typeof key!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))fail(400,'IDEMPOTENCY_KEY_REQUIRED','A UUID idempotency key is required');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+key]);
    const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1',[key])).rows[0];
    let result;
    if(prior){
      const same=(await client.query('SELECT $1::jsonb=$2::jsonb AS same',[prior.payload_json,req.body])).rows[0].same;
      if(prior.user_id!==req.user.userId||prior.device_id!=='download-settings-http'||prior.entity_type!=='media_download_settings'||prior.entity_id!=='global'||prior.operation!=='update'||!same)fail(409,'IDEMPOTENCY_MISMATCH','Key belongs to another settings intent');
      result=prior.response_json;
    }else{
      result=await applyDownloadSettings(client,{change_id:key,entity_id:'global',operation:'update',payload:req.body,__device_id:'download-settings-http'},req.user);
      await client.query(`INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status)
        VALUES($1,'download-settings-http',$2,'media_download_settings','global','update',$3,$4,200)`,[key,req.user.userId,req.body,result]);
    }
    await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
