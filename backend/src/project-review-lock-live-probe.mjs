// Two real PostgreSQL connections. No committed writes or schema changes.
// Exercises row-lock exclusion, not the complete concurrent approval workflow.
import assert from 'node:assert/strict';
import {pool} from 'file:///app/src/db.js';
const packet=globalThis.labosReviewLockProbe;
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const permissions=data(packet.permissions.replace("'../db.js'","'file:///app/src/db.js'"));
const {requireProjectReviewAuthority}=await import(data(packet.authority.replace("'./middleware/permissions.js'",JSON.stringify(permissions))));
const a=await pool.connect(),b=await pool.connect();
try{
  await a.query('BEGIN');await a.query("SET LOCAL statement_timeout='5s'");
  const project=(await a.query('SELECT * FROM projects ORDER BY id LIMIT 1 FOR UPDATE')).rows[0];
  const actor=(await a.query("SELECT id FROM users WHERE is_active AND role='admin' ORDER BY id LIMIT 1")).rows[0];
  assert.ok(project&&actor,'Existing project and active admin required; probe never creates data');
  await requireProjectReviewAuthority(a,project,{userId:actor.id},'approve');
  async function blocked(sql,id){
    await b.query('BEGIN');await b.query("SET LOCAL lock_timeout='250ms'");await b.query("SET LOCAL statement_timeout='2s'");
    try{await assert.rejects(b.query(sql,[id]),e=>e.code==='55P03');}
    finally{await b.query('ROLLBACK');}
  }
  await blocked('UPDATE projects SET name=name WHERE id=$1',project.id);
  await blocked('UPDATE users SET is_active=is_active WHERE id=$1',actor.id);
  // Permission replacement takes this lock BEFORE deleting/inserting overrides.
  // It must block even when the deny row it intends to insert does not exist.
  await blocked('SELECT id FROM users WHERE id=$1 FOR UPDATE',actor.id);
  await a.query('ROLLBACK');
  await b.query('BEGIN');await b.query("SET LOCAL lock_timeout='250ms'");
  await b.query('UPDATE projects SET name=name WHERE id=$1',[project.id]);
  await b.query('UPDATE users SET is_active=is_active WHERE id=$1',[actor.id]);
  await b.query('ROLLBACK');
  console.log('PASS: independent connection cannot update the locked project or active actor during review authority; both locks release after rollback. All attempted writes rolled back.');
}finally{await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();await pool.end();}
