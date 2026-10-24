import {getUserPermissions} from './middleware/permissions.js';
import {applyProjectReviewDecision} from './project-review-decision.js';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export async function applyProjectReviewIntent(client,change,user) {
  const p=change.payload;
  if(change.operation!=='decision'||!p||p.project_id!==change.entity_id||typeof p.expected_token!=='string'||!p.expected_token)
    fail(400,'INVALID_REVIEW_INTENT','Project review intention requires a synchronized version');
  const project=(await client.query("SELECT p.*,'plan-v1:' || p.plan_revision::text AS review_token FROM projects p WHERE p.id=$1 FOR UPDATE",[p.project_id])).rows[0];
  if(!project)fail(409,'REVIEW_PROJECT_MISSING','Project no longer exists');
  const actor=(await client.query('SELECT role,is_active FROM users WHERE id=$1 FOR SHARE',[user.userId])).rows[0];
  const permissions=actor&&await getUserPermissions(user.userId,actor.role);
  const member=(await client.query('SELECT member_role FROM project_members WHERE project_id=$1 AND user_id=$2',[project.id,user.userId])).rows[0];
  const grant=(await client.query("SELECT access_level FROM record_access_grants WHERE entity_type='project' AND entity_id=$1 AND user_id=$2",[project.id,user.userId])).rows[0];
  if(!actor?.is_active||!permissions?.has('projects.edit')||
    (actor.role!=='admin'&&(p.decision!=='submit'||actor.role==='viewer'||
      (project.owner_id!==user.userId&&member?.member_role!=='lead')||
      (project.visibility==='restricted'&&grant?.access_level!=='edit'))))
    fail(403,'REVIEW_AUTHORITY_DENIED','Only an authorized project lead may submit; approval requires an active administrator');
  if(project.review_token!==p.expected_token)fail(409,'REVIEW_VERSION_CONFLICT','Project changed after this review snapshot. Preserve the note, synchronize and review again.');
  await applyProjectReviewDecision(client,project,{user:{userId:user.userId}},p.decision,p.note);
  return {acknowledged:true};
}
