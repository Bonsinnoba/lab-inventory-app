// Existing development users only; all attempted writes roll back.
import assert from 'node:assert/strict';
import {pool} from './db.js';
import {requirePermissionReplacementAuthority as authorize} from './permission-replacement-authority.js';
if(process.env.LABOS_DEV_REVIEW_PROBE!=='1')throw Error('Development opt-in required');
const a=await pool.connect(),b=await pool.connect();
try{
  const actor=(await a.query("SELECT id FROM users WHERE role='admin' AND is_active ORDER BY id LIMIT 1")).rows[0];
  const target=(await a.query("SELECT id FROM users WHERE role<>'admin' ORDER BY id LIMIT 1")).rows[0];
  assert.ok(actor&&target,'Existing development admin and nonadmin required');
  await a.query('BEGIN');await authorize(a,actor.id,target.id,[]);
  for(const id of [actor.id,target.id]){
    await b.query('BEGIN');await b.query("SET LOCAL lock_timeout='300ms'");
    await assert.rejects(b.query('UPDATE users SET is_active=NOT is_active WHERE id=$1',[id]),e=>e.code==='55P03');
    await b.query('ROLLBACK');
  }
  await a.query('ROLLBACK');
  await b.query('BEGIN');await b.query('UPDATE users SET is_active=false WHERE id=$1',[actor.id]);
  await a.query('BEGIN');await a.query("SET LOCAL lock_timeout='300ms'");
  await assert.rejects(authorize(a,actor.id,target.id,[]),e=>e.code==='55P03');
  await a.query('ROLLBACK');await b.query('ROLLBACK');
  await a.query('BEGIN');await a.query('UPDATE users SET is_active=false WHERE id=$1',[actor.id]);
  await assert.rejects(authorize(a,actor.id,target.id,[]),e=>e.code==='ACCOUNT_DISABLED');
  await a.query('ROLLBACK');
  await a.query('BEGIN');await a.query("UPDATE users SET role='member' WHERE id=$1",[actor.id]);
  await a.query('DELETE FROM user_permission_overrides WHERE user_id=$1',[actor.id]);
  await assert.rejects(authorize(a,actor.id,target.id,[]),e=>e.code==='PERMISSION_DENIED');
  await a.query('ROLLBACK');
  console.log('PASS: actor/target locking, reverse lock order, disabled/demoted authority rejection; all writes rolled back.');
}finally{await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();await pool.end();}
