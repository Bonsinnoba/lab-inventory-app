import {createHmac} from 'node:crypto';
import {config} from './config.js';
import {catalogUuid} from './catalog-sync.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=value=>createHmac('sha256',config.jwtSecret).update(JSON.stringify(canonical(value))).digest('hex');
export async function managementSnapshot(client,targetId=null){
 const rows=(await client.query(`SELECT u.id,u.username,u.role,u.is_active,u.last_login_at,u.created_at,u.password_hash,u.credential_version,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('permission',o.permission,'effect',o.effect) ORDER BY o.permission) FROM user_permission_overrides o WHERE o.user_id=u.id),'[]'::jsonb) AS overrides
 FROM users u ${targetId?'WHERE u.id=$1':''} ORDER BY u.username`,targetId?[targetId]:[])).rows;
 return rows.map(row=>{const {password_hash,credential_version,overrides,...publicRow}=row;return {user:{...publicRow,management_etag:digest({id:row.id,username:row.username,role:row.role,is_active:row.is_active,password_hash,credential_version,overrides})},overrides};});
}
// Caller has locked/rechecked current actor and target authority. Receipts store
// ONLY a keyed request digest and sanitized response, never a password or body.
export async function lockAdministrativeIntent(client,req){const raw=req.get?.('Idempotency-Key');if(!raw)return null;const key=catalogUuid(raw);await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sync-change:'+key]);return key;}
export async function beginAdministrativeIntent(client,req,operation,targetId=null){
 const key=await lockAdministrativeIntent(client,req);if(!key)return null;
 const fingerprint={protocol:1,digest:digest({actor:req.user.userId,operation,target:targetId,body:req.body})};
 const prior=(await client.query('SELECT user_id,device_id,entity_type,operation,payload_json,response_json,response_status FROM sync_idempotency WHERE change_id=$1 FOR UPDATE',[key])).rows[0];
 if(prior){if(prior.user_id!==req.user.userId||prior.device_id!=='administrative-http-v1'||prior.entity_type!=='managed_user'||prior.operation!==operation||prior.payload_json?.digest!==fingerprint.digest)fail(409,'ADMIN_RETRY_MISMATCH','This retry identity belongs to a different administrative request');return{key,fingerprint,replay:true,response:prior.response_json,status:prior.response_status};}
 if(targetId){const current=(await managementSnapshot(client,targetId))[0];if(!current)fail(404,'USER_NOT_FOUND','User not found');if(typeof req.body?.expected_management_etag!=='string'||req.body.expected_management_etag!==current.user.management_etag)fail(409,'ADMIN_REVIEW_STALE','This account or its permissions changed. Refresh and review before applying the change.');}
 return{key,fingerprint,replay:false};
}
export async function finishAdministrativeIntent(client,req,intent,operation,targetId,response,status=200){if(!intent)return;await client.query('INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[intent.key,'administrative-http-v1',req.user.userId,'managed_user',targetId,operation,intent.fingerprint,response,status]);}
