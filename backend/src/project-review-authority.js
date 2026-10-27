import {getUserPermissions} from './middleware/permissions.js';

// Call inside the decision transaction, after locking the project. Never trust
// the role/permissions cached by HTTP middleware or carried in a sync request.
export async function requireProjectReviewAuthority(client,project,user,decision) {
  const actor=(await client.query('SELECT role,is_active FROM users WHERE id=$1 FOR SHARE',[user.userId])).rows[0];
  const permissions=actor?.is_active&&await getUserPermissions(user.userId,actor.role,{client,lock:true});
  const member=(await client.query('SELECT member_role FROM project_members WHERE project_id=$1 AND user_id=$2 FOR SHARE',[project.id,user.userId])).rows[0];
  const grant=(await client.query("SELECT access_level FROM record_access_grants WHERE entity_type='project' AND entity_id=$1 AND user_id=$2 FOR SHARE",[project.id,user.userId])).rows[0];
  if(!actor?.is_active||!permissions?.has('projects.edit')||
    (actor.role!=='admin'&&(decision!=='submit'||actor.role==='viewer'||
      (project.owner_id!==user.userId&&member?.member_role!=='lead')||
      (project.visibility==='restricted'&&grant?.access_level!=='edit'))))
    throw Object.assign(new Error('Only an authorized project lead may submit; approval requires an active administrator'),{status:403,code:'REVIEW_AUTHORITY_DENIED'});
  return permissions;
}
