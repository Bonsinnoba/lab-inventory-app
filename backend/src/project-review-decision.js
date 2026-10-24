import { writeAuditLog } from './middleware/audit.js';

const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};

// Caller must authorize the active actor, begin a transaction and lock the
// project FOR UPDATE. This helper never commits: audit failure must roll back
// the project change AND event. Sync replay/idempotency belongs to the caller.
export async function applyProjectReviewDecision(client, project, req, decision, note) {
  if(!['submit','request_changes','approve'].includes(decision))fail(400,'INVALID_REVIEW_DECISION','Invalid review decision');
  if(typeof note!=='string'||note.length>2000)fail(400,'INVALID_REVIEW_NOTE','Review note must be text, at most 2000 characters');
  note=note.trim();
  if(decision==='request_changes'&&!note)fail(400,'REVIEW_REASON_REQUIRED','Explain the requested changes');
  if(project.status!=='planning')fail(409,'REVIEW_STATE_CONFLICT','Only Planning projects can be reviewed');
  if(decision==='submit'&&!['draft','changes_requested'].includes(project.review_status))fail(409,'REVIEW_STATE_CONFLICT','Plan is already submitted or approved');
  if(decision!=='submit'&&project.review_status!=='submitted')fail(409,'REVIEW_STATE_CONFLICT','Submit the plan before an admin decision');
  const next=decision==='submit'?'submitted':decision==='approve'?'approved':'changes_requested';
  const updated=(await client.query(`UPDATE projects SET review_status=$1,
    status=CASE WHEN $2='approve' THEN 'active' ELSE status END,updated_at=now()
    WHERE id=$3 RETURNING *`,[next,decision,project.id])).rows[0];
  await client.query('INSERT INTO project_review_events(project_id,actor_id,decision,note) VALUES($1,$2,$3,$4)',[project.id,req.user.userId,decision,note||null]);
  await writeAuditLog({req,action:'UPDATE',entityType:'project',entityId:project.id,
    oldValue:{review_status:project.review_status,status:project.status},
    newValue:{review_decision:decision,review_status:next,status:updated.status},
    client,required:true});
  return updated;
}
