import {getUserPermissions} from './middleware/permissions.js';
import {effectiveProjectAccess} from './middleware/project-access.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};

// Called inside the mutation transaction. Use current database authority, not
// cached role claims. Existing membership/grant rows remain locked until commit.
export async function requireSalvageMutation(client,projectId,actor,permission){
 const user=(await client.query('SELECT role,is_active FROM users WHERE id=$1 FOR SHARE',[actor])).rows[0];
 if(!user?.is_active)fail(403,'ACCOUNT_DISABLED','Account is inactive');
 const permissions=await getUserPermissions(actor,user.role,{client,lock:true});
 if(!permissions.has(permission))fail(403,'PERMISSION_DENIED',`Permission required: ${permission}`);
 if(!projectId)return;
 const project=(await client.query('SELECT owner_id,visibility FROM projects WHERE id=$1 FOR SHARE',[projectId])).rows[0];
 if(!project)fail(403,'PROJECT_ACCESS_DENIED','Project edit access is required');
 const member=(await client.query('SELECT member_role FROM project_members WHERE project_id=$1 AND user_id=$2 FOR SHARE',[projectId,actor])).rows[0];
 const grant=(await client.query("SELECT access_level FROM record_access_grants WHERE entity_type='project' AND entity_id=$1 AND user_id=$2 FOR SHARE",[projectId,actor])).rows[0];
 const access=effectiveProjectAccess({ownerId:project.owner_id,visibility:project.visibility,
  memberRole:member?.member_role,grantLevel:grant?.access_level,userId:actor,role:user.role,canEdit:permissions.has('projects.edit')});
 if(!['edit','admin'].includes(access.access))fail(403,'PROJECT_ACCESS_DENIED','Project edit access is required');
}
