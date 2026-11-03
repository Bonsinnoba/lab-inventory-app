import {getUserPermissions} from './middleware/permissions.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export async function requireProjectWorkAuthority(client,projectId,userId){
 const p=(await client.query('SELECT id,owner_id,visibility FROM projects WHERE id=$1 FOR UPDATE',[projectId])).rows[0];
 if(!p)fail(404,'PROJECT_NOT_FOUND','Project not found');
 const actor=(await client.query('SELECT role,is_active FROM users WHERE id=$1 FOR SHARE',[userId])).rows[0];
 const permissions=actor?.is_active&&await getUserPermissions(userId,actor.role,{client,lock:true});
 const member=(await client.query('SELECT member_role FROM project_members WHERE project_id=$1 AND user_id=$2 FOR SHARE',[projectId,userId])).rows[0];
 const grant=(await client.query("SELECT access_level FROM record_access_grants WHERE entity_type='project' AND entity_id=$1 AND user_id=$2 FOR SHARE",[projectId,userId])).rows[0];
 if(!actor?.is_active||!permissions?.has('projects.edit')||(actor.role!=='admin'&&(actor.role==='viewer'||(p.owner_id!==userId&&!['lead','member'].includes(member?.member_role))||(p.visibility==='restricted'&&grant?.access_level!=='edit'))))fail(403,'PROJECT_EDIT_REQUIRED','Current project edit authority required');
 return {role:actor.role,permissions,userId,project:p};
}
