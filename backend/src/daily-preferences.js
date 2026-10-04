import { writeAuditLog } from './middleware/audit.js';
function fail(status,code,message){throw Object.assign(new Error(message),{status,code});}
export async function readDailyPreferences(client,userId){
  const row=(await client.query('SELECT * FROM user_daily_use_preferences WHERE user_id=$1',[userId])).rows[0];
  return {
    notifications_enabled:row?.notifications_enabled??true,sync_version:row?.sync_version??0,updated_at:row?.updated_at??null,
    legacy_media:row?{auto_pause_music:row.auto_pause_music,music_volume:Number(row.music_volume)}:null,
  };
}
export async function applyDailyPreferenceChange(client,change,user){
  if(change.operation!=='update'||change.entity_id!==user.userId)fail(403,'PREFERENCE_ACCOUNT_MISMATCH','Preferences belong to the authenticated account');
  const payload=change.payload;
  if(!payload || typeof payload.notifications_enabled!=='boolean' || !Number.isSafeInteger(payload.expected_version) || payload.expected_version<0)fail(400,'INVALID_PREFERENCE','A boolean notification setting and expected version are required');
  if(Object.keys(payload).some(key=>!['notifications_enabled','expected_version','depends_on'].includes(key)))fail(400,'DEVICE_PREFERENCE_ONLY','Music preferences stay on this device');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['daily-preference:'+user.userId]);
  let expected=payload.expected_version;
  if(payload.depends_on){
    const prior=(await client.query("SELECT response_json FROM sync_idempotency WHERE change_id=$1 AND user_id=$2 AND entity_type='daily_preferences' AND entity_id=$2::text",[payload.depends_on,user.userId])).rows[0];
    if(!prior)fail(409,'SYNC_DEPENDENCY_PENDING','An earlier notification preference must be resolved first');
    expected=prior.response_json.sync_version;
  }
  const current=await readDailyPreferences(client,user.userId);
  if(current.notifications_enabled===payload.notifications_enabled)return {notifications_enabled:current.notifications_enabled,sync_version:current.sync_version,updated_at:current.updated_at};
  if(current.sync_version!==expected)fail(409,'SYNC_CONFLICT','Notification preference changed on another device. Accept the server value, or review and reapply.');
  const row=(await client.query(`INSERT INTO user_daily_use_preferences(user_id,notifications_enabled)
    VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET notifications_enabled=EXCLUDED.notifications_enabled
    RETURNING notifications_enabled,sync_version,updated_at`,[user.userId,payload.notifications_enabled])).rows[0];
  await writeAuditLog({req:{user},client,required:true,action:'UPDATE',entityType:'daily_preferences',entityId:user.userId,oldValue:{notifications_enabled:current.notifications_enabled},newValue:row,metadata:{change_id:change.change_id}});
  return row;
}

export async function patchDailyPreferences(pool,req){
  const key=req.get('Idempotency-Key');
  if(typeof key!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))fail(400,'IDEMPOTENCY_KEY_REQUIRED','A UUID Idempotency-Key is required');
  const payload=req.body;
  const c=await pool.connect();
  try{
    await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+key]);
    const prior=(await c.query('SELECT * FROM sync_idempotency WHERE change_id=$1',[key])).rows[0];
    let result;
    if(prior){
      const same=(await c.query('SELECT $1::jsonb=$2::jsonb AS same',[prior.payload_json,payload])).rows[0].same;
      if(prior.user_id!==req.user.userId||prior.entity_type!=='daily_preferences'||prior.operation!=='update'||prior.device_id!=='preferences-http'||!same)fail(409,'IDEMPOTENCY_MISMATCH','Idempotency key belongs to another preference intent');
      result=prior.response_json;
    }else{
      result=await applyDailyPreferenceChange(c,{change_id:key,entity_id:req.user.userId,operation:'update',payload},req.user);
      await c.query(`INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status)
        VALUES($1,'preferences-http',$2,'daily_preferences',$2::text,'update',$3,$4,200)`,[key,req.user.userId,payload,result]);
    }
    await c.query('COMMIT');return result;
  }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}
