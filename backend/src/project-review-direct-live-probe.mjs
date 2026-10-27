// Development PostgreSQL only; all records and audit entries roll back.
import assert from 'node:assert/strict';
import {pool} from './db.js';
import {requireProjectReviewAuthority} from './project-review-authority.js';
import {applyProjectReviewDecision} from './project-review-decision.js';
import {projectDateValue} from './project-date-value.js';
const c=await pool.connect();
try {
  await c.query('BEGIN');
  const actor=(await c.query("SELECT id FROM users WHERE is_active AND role='admin' LIMIT 1")).rows[0];
  assert.ok(actor,'Development administrator required');
  const p=(await c.query("INSERT INTO projects(name,status,review_status,owner_id,start_date,due_date) VALUES('Rollback-only direct approval','planning','draft',$1,$2,$3) RETURNING *",[actor.id,projectDateValue('start_date',''),projectDateValue('due_date','')])).rows[0];
  const lock=async()=>(await c.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE',[p.id])).rows[0];
  await requireProjectReviewAuthority(c,await lock(),{userId:actor.id},'approve');
  await c.query('SAVEPOINT before_failure');
  const failing={query:(sql,args)=>{if(sql.includes('INSERT INTO audit_log'))throw Error('forced audit failure');return c.query(sql,args);}};
  await assert.rejects(applyProjectReviewDecision(failing,await lock(),{user:{userId:actor.id}},'approve',''),/forced audit/);
  await c.query('ROLLBACK TO SAVEPOINT before_failure');
  assert.equal((await lock()).status,'planning');
  const result=await applyProjectReviewDecision(c,await lock(),{user:{userId:actor.id}},'approve','Owner reviewed');
  assert.equal(result.status,'active');assert.equal(result.review_status,'approved');
  assert.equal(result.start_date,null);assert.equal(result.due_date,null);
  assert.equal((await c.query('SELECT count(*)::int AS n FROM project_review_events WHERE project_id=$1',[p.id])).rows[0].n,1);
  await assert.rejects(applyProjectReviewDecision(c,await lock(),{user:{userId:actor.id}},'approve',''),e=>e.code==='REVIEW_STATE_CONFLICT');
  console.log('PASS: direct admin approval, blank dates, audit rollback, duplicate state rejection (fixtures rolled back)');
} finally {await c.query('ROLLBACK');c.release();await pool.end();}
