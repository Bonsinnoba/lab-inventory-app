import {requireProjectReviewAuthority} from './project-review-authority.js';
import {applyProjectReviewDecision} from './project-review-decision.js';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export async function applyProjectReviewIntent(client,change,user) {
  const p=change.payload;
  if(change.operation!=='decision'||!p||p.project_id!==change.entity_id||typeof p.expected_token!=='string'||!p.expected_token)
    fail(400,'INVALID_REVIEW_INTENT','Project review intention requires a synchronized version');
  const project=(await client.query("SELECT p.*,'plan-v1:' || p.plan_revision::text AS review_token FROM projects p WHERE p.id=$1 FOR UPDATE",[p.project_id])).rows[0];
  if(!project)fail(409,'REVIEW_PROJECT_MISSING','Project no longer exists');
  await requireProjectReviewAuthority(client,project,user,p.decision);
  if(project.review_token!==p.expected_token)fail(409,'REVIEW_VERSION_CONFLICT','Project changed after this review snapshot. Preserve the note, synchronize and review again.');
  await applyProjectReviewDecision(client,project,{user:{userId:user.userId}},p.decision,p.note);
  return {acknowledged:true};
}
