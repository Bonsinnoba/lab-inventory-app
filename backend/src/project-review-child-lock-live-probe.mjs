// Development PostgreSQL only. Two connections, bounded lock waits, no commits.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {applyProjectReviewIntent} from './project-review-sync.js';

if (process.env.LABOS_DEV_REVIEW_PROBE !== '1') throw Error('Explicit development probe opt-in required');
const a=await pool.connect(), b=await pool.connect();
const begin=async c=>{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='5s'");await c.query("SET LOCAL lock_timeout='300ms'");};
try {
  const actor=(await a.query("SELECT id FROM users WHERE is_active AND role='admin' ORDER BY id LIMIT 1")).rows[0];
  assert.ok(actor,'Development administrator required');
  let exercised=0;
  // Identifiers below are a fixed allowlist, never caller-supplied SQL.
  for (const [table,column] of [['project_tasks','title'],['project_experiments','title'],['project_bom_items','name'],['project_blocks','title']]) {
    let child=(await a.query(`SELECT c.id,c.project_id,p.plan_revision FROM ${table} c JOIN projects p ON p.id=c.project_id ORDER BY c.id LIMIT 1`)).rows[0];
    let insertBom=false;
    if(!child&&table==='project_bom_items') {
      const parent=(await a.query('SELECT id AS project_id,plan_revision FROM projects ORDER BY id LIMIT 1')).rows[0];
      if(parent){child={...parent,id:randomUUID()};insertBom=true;}
    }
    if(!child){console.log(`SKIP ${table}: no existing development fixture`);continue;}
    const edit=insertBom ? "INSERT INTO project_bom_items(id,project_id,name,required_quantity) VALUES($1,$2,'Rollback-only BOM lock probe',1)" : `UPDATE ${table} SET ${column}=COALESCE(${column},'') || ' [rollback-only lock probe]' WHERE id=$1`;
    const editArgs=insertBom?[child.id,child.project_id]:[child.id];
    // Approval has parent lock first: real child UPDATE/trigger cannot escape it.
    await begin(a);await a.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[child.project_id]);
    await begin(b);
    await assert.rejects(b.query(edit,editArgs),e=>e.code==='55P03');
    await b.query('ROLLBACK');await a.query('ROLLBACK');
    // Child edit first: its trigger holds the parent lock; real review helper waits.
    await begin(b);await b.query(edit,editArgs);
    const revised=(await b.query('SELECT plan_revision FROM projects WHERE id=$1',[child.project_id])).rows[0].plan_revision;
    assert.equal(BigInt(revised),BigInt(child.plan_revision)+1n);
    const intent={operation:'decision',entity_id:child.project_id,payload:{project_id:child.project_id,expected_token:`plan-v1:${child.plan_revision}`,decision:'approve',note:'Rollback-only concurrency probe'}};
    await begin(a);
    await assert.rejects(applyProjectReviewIntent(a,intent,{userId:actor.id}),e=>e.code==='55P03');
    await a.query('ROLLBACK');await b.query('ROLLBACK');
    // In a transaction that sees the changed child, old tokens fail before any decision.
    await begin(a);await a.query(edit,editArgs);
    await assert.rejects(applyProjectReviewIntent(a,intent,{userId:actor.id}),e=>e.code==='REVIEW_VERSION_CONFLICT');
    await a.query('ROLLBACK');
    assert.equal((await a.query('SELECT plan_revision FROM projects WHERE id=$1',[child.project_id])).rows[0].plan_revision,child.plan_revision);
    if(insertBom)assert.equal((await a.query('SELECT id FROM project_bom_items WHERE id=$1',[child.id])).rowCount,0);
    exercised++;console.log(`PASS ${table} (${insertBom?'insert':'update'}): both lock orders, stale token rejection, revision rollback`);
  }
  assert.ok(exercised,'No development child fixtures available; nothing verified');
  console.log(`PASS ${exercised} child types. No writes committed; no desktop transport acceptance claimed.`);
} finally {
  await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();await pool.end();
}
