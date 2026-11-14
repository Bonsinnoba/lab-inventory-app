import {credentialVersionMatches} from './credential-version.js';
import {writeAuditLog} from './middleware/audit.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export function profileFields(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['display_name','email'].includes(k)))fail(400,'INVALID_PROFILE','Only display name and contact email may change');
 const display=value.display_name===null?null:typeof value.display_name==='string'?value.display_name.trim()||null:undefined;
 const email=value.email===null?null:typeof value.email==='string'?value.email.trim().toLowerCase()||null:undefined;
 if(display===undefined||email===undefined||display?.length>120||email&&(email.length>254||!/^\S+@\S+\.\S+$/.test(email)))fail(400,'INVALID_PROFILE','Invalid display name or contact email');
 return{display_name:display,email};
}
export async function applyAccountProfile(client,change,user){
 if(change.operation!=='update'||change.entity_id!==user.userId)fail(403,'PROFILE_OWNER_REQUIRED','Only your own contact profile may change');
 const profile=profileFields(change.payload?.profile),expected=profileFields(change.payload?.expected_before);
 const current=(await client.query('SELECT id,is_active,credential_version,display_name,email FROM users WHERE id=$1 FOR UPDATE',[user.userId])).rows[0];
 if(!current?.is_active||!credentialVersionMatches({credentialVersion:change.__credential_version},current))fail(401,'SESSION_REVOKED','Current credentials required');
 if(change.payload.previous_change_id){
  const prior=(await client.query("SELECT response_json FROM sync_idempotency WHERE change_id=$1 AND user_id=$2 AND device_id=$3 AND entity_type='account_profile' AND entity_id=$2::text AND operation='update'",[change.payload.previous_change_id,user.userId,change.__device_id])).rows[0];
  if(!prior||prior.response_json?.id!==user.userId)fail(409,'SYNC_DEPENDENCY_PENDING','Synchronize the preceding profile change first');
 }
 if((current.display_name??null)!==expected.display_name||(current.email??null)!==expected.email)fail(409,'PROFILE_REVIEW_STALE','Your server contact profile changed. Local edits are preserved for review.');
 await client.query('UPDATE users SET display_name=$1,email=$2 WHERE id=$3',[profile.display_name,profile.email,user.userId]);
 await writeAuditLog({req:{user},client,required:true,action:'UPDATE',entityType:'user_profile',entityId:user.userId,oldValue:{display_name:current.display_name,email:current.email},newValue:profile,deviceId:change.__device_id,metadata:{change_id:change.change_id}});
 return{id:user.userId,profile};
}
