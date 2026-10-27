import {getUserPermissions} from './middleware/permissions.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};

// All override writers must take the target user lock before mutating overrides.
// Lock actor and target in a consistent order, including reciprocal requests.
export async function requirePermissionReplacementAuthority(client,actorId,targetId,entries) {
  const users=(await client.query('SELECT id, username, role, is_active FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[actorId,targetId]])).rows;
  const actor=users.find(u=>u.id===actorId),target=users.find(u=>u.id===targetId);
  if(!actor?.is_active)fail(403,'ACCOUNT_DISABLED','Acting account is unavailable or disabled');
  if(!target)fail(404,'USER_NOT_FOUND','User not found');
  const permissions=await getUserPermissions(actor.id,actor.role,{client,lock:true});
  if(!permissions.has('users.manage_permissions'))fail(403,'PERMISSION_DENIED','Permission required: users.manage_permissions');
  if(target.role==='admin')fail(400,'ADMIN_PERMISSION_OVERRIDES_UNSUPPORTED','Administrator permissions cannot be overridden');
  const previous=(await client.query('SELECT permission,effect FROM user_permission_overrides WHERE user_id=$1 FOR UPDATE',[targetId])).rows;
  if(actor.role!=='admin'){
    const before=new Map(previous.map(e=>[e.permission,e.effect]));
    const after=new Map(entries.map(e=>[e.permission,e.effect]));
    for(const permission of new Set([...before.keys(),...after.keys()])){
      if(before.get(permission)!==after.get(permission)&&!permissions.has(permission))
        fail(403,'PERMISSION_ESCALATION_BLOCKED',`You cannot change permission: ${permission}`);
    }
  }
  return {id:target.id,username:target.username,role:target.role};
}
