import assert from 'node:assert/strict';
import {pool} from './db.js';
import {applyProjectReviewIntent} from './project-review-sync.js';
const c=await pool.connect();
try {
  await c.query('BEGIN');
  const admin=(await c.query("SELECT id FROM users WHERE is_active AND role='admin' LIMIT 1")).rows[0];assert.ok(admin);
  const p=(await c.query("INSERT INTO projects(name,status,review_status,owner_id) VALUES('Rollback-only queued review probe','planning','draft',$1) RETURNING id",[admin.id])).rows[0];
  const token=async()=>(await c.query("SELECT 'plan-v1:' || plan_revision::text AS token FROM projects WHERE id=$1",[p.id])).rows[0].token;
  const intent={entity_id:p.id,operation:'decision',payload:{project_id:p.id,decision:'submit',note:'preserved test note',expected_token:await token()}};
  await assert.rejects(applyProjectReviewIntent(c,intent,{userId:'00000000-0000-4000-8000-000000000001'}),e=>e.code==='REVIEW_AUTHORITY_DENIED');
  assert.deepEqual(await applyProjectReviewIntent(c,intent,{userId:admin.id}),{acknowledged:true});
  intent.payload.decision='approve';
  // Explicit mismatch complements the real child-edit/replay cases in
  // project-review-push-live-probe.mjs (which applies its migration in rollback).
  intent.payload.expected_token='stale-snapshot-token';
  await assert.rejects(applyProjectReviewIntent(c,intent,{userId:admin.id}),e=>e.code==='REVIEW_VERSION_CONFLICT');
  intent.payload.expected_token=await token();
  await applyProjectReviewIntent(c,intent,{userId:admin.id});
  assert.equal((await c.query('SELECT status FROM projects WHERE id=$1',[p.id])).rows[0].status,'active');
  assert.equal((await c.query('SELECT count(*)::int AS n FROM project_review_events WHERE project_id=$1',[p.id])).rows[0].n,2);
  assert.equal((await c.query('SELECT count(*)::int AS n FROM audit_log WHERE entity_id=$1',[p.id])).rows[0].n,2);
  console.log('PASS: queued review authority, stale project token rejection, submit/approve, atomic event/audit writes');
}finally{await c.query('ROLLBACK');c.release();await pool.end();console.log('Probe fixtures rolled back.');}
