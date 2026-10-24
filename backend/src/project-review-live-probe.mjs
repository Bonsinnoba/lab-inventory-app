// Run against the existing PostgreSQL database. All fixture writes roll back.
import assert from 'node:assert/strict';
import {pool} from './db.js';
import {applyProjectReviewDecision} from './project-review-decision.js';

const c=await pool.connect();
try {
  await c.query('BEGIN');
  const actor=(await c.query("SELECT id FROM users WHERE is_active AND role='admin' LIMIT 1")).rows[0];
  assert.ok(actor,'An active test administrator is required');
  const req={user:{userId:actor.id},ip:null};
  const project=(await c.query("INSERT INTO projects(name,status,review_status,owner_id) VALUES('P2 rollback-only review probe','planning','draft',$1) RETURNING *",[actor.id])).rows[0];
  const lock=async()=>(await c.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE',[project.id])).rows[0];
  await c.query('SAVEPOINT audit_failure');
  const failedAudit={query:async(sql,args)=>{
    if(sql.includes('INSERT INTO audit_log'))throw new Error('PROBE_FORCED_AUDIT_FAILURE');
    return c.query(sql,args);
  }};
  await assert.rejects(applyProjectReviewDecision(failedAudit,await lock(),req,'submit','must roll back'),/PROBE_FORCED_AUDIT_FAILURE/);
  await c.query('ROLLBACK TO SAVEPOINT audit_failure');
  assert.equal((await lock()).review_status,'draft');
  assert.equal((await c.query('SELECT count(*)::int AS n FROM project_review_events WHERE project_id=$1',[project.id])).rows[0].n,0);
  assert.equal((await c.query('SELECT count(*)::int AS n FROM audit_log WHERE entity_id=$1',[project.id])).rows[0].n,0);
  const submitted=await applyProjectReviewDecision(c,await lock(),req,'submit',' test submission ');
  assert.equal(submitted.review_status,'submitted');assert.equal(submitted.status,'planning');
  await assert.rejects(applyProjectReviewDecision(c,await lock(),req,'submit','repeat'),e=>e.code==='REVIEW_STATE_CONFLICT');
  await assert.rejects(applyProjectReviewDecision(c,await lock(),req,'request_changes',' '),e=>e.code==='REVIEW_REASON_REQUIRED');
  const approved=await applyProjectReviewDecision(c,await lock(),req,'approve','approved');
  assert.equal(approved.status,'active');assert.equal(approved.review_status,'approved');
  assert.equal(approved.lifecycle_revision,project.lifecycle_revision+1);
  await assert.rejects(applyProjectReviewDecision(c,await lock(),req,'approve','repeat'),e=>e.code==='REVIEW_STATE_CONFLICT');
  assert.equal((await c.query('SELECT count(*)::int AS n FROM project_review_events WHERE project_id=$1',[project.id])).rows[0].n,2);
  assert.equal((await c.query('SELECT count(*)::int AS n FROM audit_log WHERE entity_id=$1',[project.id])).rows[0].n,2);
  console.log('PASS: review submit/approve, duplicate-state rejection, reason validation, lifecycle revision and audit-failure rollback');
} finally {
  await c.query('ROLLBACK');c.release();await pool.end();
  console.log('Probe fixtures rolled back; existing data preserved.');
}
