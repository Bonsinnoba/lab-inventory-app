import {getUserPermissions} from './middleware/permissions.js';
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};

// Called inside the resource transaction. Permission-management writers lock
// this same account row, so a middleware snapshot cannot outlive a role/reset.
export async function currentResourceActor(client,user){
 const actor=(await client.query('SELECT role,is_active,credential_version FROM users WHERE id=$1 FOR SHARE',[user.userId])).rows[0];
 if(!actor?.is_active)fail(401,'ACCOUNT_DISABLED','Account is disabled or no longer exists');
 if(actor.credential_version!==user.credentialVersion)fail(401,'SESSION_REVOKED','Credentials changed; sign in again');
 return {...user,role:actor.role};
}

export async function authorizeResourceMutation(client,change,user){
 const current=await currentResourceActor(client,user);
 const permissions=await getUserPermissions(current.userId,current.role,{client,lock:true});
 const required=['resources.view',...(['create','create_copy'].includes(change.operation)?['resources.create']:change.operation==='delete'?['resources.delete']:['resources.edit']),...(change.operation==='create_copy'?['resources.edit']:[])];
 for(const permission of required)if(!permissions.has(permission))fail(403,'PERMISSION_DENIED',`Permission required: ${permission}`);
 change.__role=current.role;
 return current;
}
