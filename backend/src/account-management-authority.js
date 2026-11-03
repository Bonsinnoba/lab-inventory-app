import {catalogUuid} from './catalog-sync.js';
import {getUserPermissions} from './middleware/permissions.js';
import {credentialVersionMatches} from './credential-version.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};

// Match granular-override management's sorted participant lock order. The role
// update route also holds its existing global last-administrator lock first.
export async function requireAccountManagementAuthority(client,user,permission,targetId=null){
 targetId=targetId?catalogUuid(targetId):null;
 const ids=[...new Set([user.userId,targetId].filter(Boolean))];
 const rows=(await client.query('SELECT id,username,role,is_active,credential_version FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids])).rows;
 const actor=rows.find(row=>row.id===user.userId),target=targetId?rows.find(row=>row.id===targetId):null;
 if(!actor?.is_active)fail(403,'ACCOUNT_DISABLED','Acting account is unavailable or disabled');
 if(!credentialVersionMatches(user,actor))fail(401,'SESSION_REVOKED','Sign in again before managing accounts');
 const permissions=await getUserPermissions(actor.id,actor.role,{client,lock:true});
 if(!permissions.has(permission))fail(403,'PERMISSION_DENIED',`Permission required: ${permission}`);
 if(targetId&&!target)fail(404,'USER_NOT_FOUND','User not found');
 if(target?.role==='admin'&&actor.role!=='admin')fail(403,'ADMIN_TARGET_PROTECTED','Only an administrator can manage an administrator account');
 return {actor,target,permissions};
}
