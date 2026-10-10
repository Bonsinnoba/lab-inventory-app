import { pool } from './db.js';
import { catalogUuid } from './catalog-sync.js';
import { readableNotifications } from './middleware/notification-visibility.js';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export async function applyNotificationRead(client,change,user){
  if(change.entity_id!==user.userId||change.operation!=='update')fail(403,'NOTIFICATION_ACCOUNT_MISMATCH','Notification intent belongs to another account');
  const values=change.payload?.ids;
  if(!Array.isArray(values)||!values.length||values.length>1000)fail(400,'INVALID_NOTIFICATION_IDS','Provide 1–1000 notification IDs observed by this client');
  const ids=[...new Set(values.map(catalogUuid))];
  const owned=await client.query('SELECT id FROM notifications WHERE id=ANY($1::uuid[]) AND user_id=$2',[ids,user.userId]);
  // Missing/deleted records are harmless, but a foreign-account record is not.
  if((await client.query('SELECT 1 FROM notifications WHERE id=ANY($1::uuid[]) AND user_id<>$2 LIMIT 1',[ids,user.userId])).rowCount)fail(403,'NOTIFICATION_ACCOUNT_MISMATCH','Notification does not belong to this account');
  const visible=new Set((await readableNotifications(user)).map(r=>r.id));
  const allowed=owned.rows.filter(r=>visible.has(r.id)).map(r=>r.id);
  const result=await client.query('UPDATE notifications SET read_at=COALESCE(read_at,clock_timestamp()) WHERE user_id=$1 AND id=ANY($2::uuid[]) AND read_at IS NULL RETURNING id',[user.userId,allowed]);
  return {ok:true,updated:result.rowCount};
}

export async function notificationReadHttp(req,res,next){
  let client;
  try{
    const key=catalogUuid(req.get('Idempotency-Key'));
    // Read-all is a frozen list, not a wildcard that can acknowledge notifications
    // delivered after the user clicked or while an uncertain request is retried.
    const payload={ids:req.params.id?[catalogUuid(req.params.id)]:req.body?.ids};
    client=await pool.connect();await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+key]);
    const prior=(await client.query('SELECT * FROM sync_idempotency WHERE change_id=$1',[key])).rows[0];
    let result;
    if(prior){
      const same=(await client.query('SELECT $1::jsonb=$2::jsonb AS same',[prior.payload_json,payload])).rows[0].same;
      if(prior.user_id!==req.user.userId||prior.entity_type!=='notification_read'||prior.entity_id!==req.user.userId||prior.operation!=='update'||prior.device_id!=='notification-http'||!same)fail(409,'IDEMPOTENCY_MISMATCH','Key belongs to another notification intent');
      result=prior.response_json;
    }else{
      result=await applyNotificationRead(client,{entity_id:req.user.userId,operation:'update',payload},req.user);
      await client.query("INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,'notification-http',$2::uuid,'notification_read',$2::text,'update',$3,$4,200)",[key,req.user.userId,payload,result]);
    }
    await client.query('COMMIT');res.json(result);
  }catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});if(error.status)return res.status(error.status).json({error:{code:error.code,message:error.message}});next(error);}finally{client?.release();}
}
