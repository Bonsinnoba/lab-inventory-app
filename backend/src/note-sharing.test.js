import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {changeNoteGrant} from './note-sharing.js';
const enabled=process.env.LABOS_SHARING_PG_TEST==='1';
async function fixture(work){const c=await pool.connect();try{
 assert.match((await c.query('SELECT current_database() AS name')).rows[0].name,/^labos_phase2_acceptance_/);
 await c.query('BEGIN');const id={actor:randomUUID(),target:randomUUID(),note:randomUUID(),project:randomUUID()};
 const actor=(await c.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','admin') RETURNING credential_version",[id.actor,`p2_note_grants_${id.actor}`])).rows[0];
 await c.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','viewer')",[id.target,`p2_note_target_${id.target}`]);
 await c.query("INSERT INTO notes(id,title,body,visibility) VALUES($1,'Note grants fixture','fixture','restricted')",[id.note]);
 await work(c,id,{userId:id.actor,role:'admin',credentialVersion:actor.credential_version});
 }finally{await c.query('ROLLBACK').catch(()=>{});c.release();}}
const count=async(c,id)=>(await c.query('SELECT count(*)::int AS n FROM audit_log WHERE entity_id=$1',[id])).rows[0].n;
test('PostgreSQL note grant retries preserve revision and produce one mandatory audit',{skip:!enabled},()=>fixture(async(c,id,user)=>{
 const added=await changeNoteGrant(c,id.note,id.target,'view',user);assert.equal(added.access_level,'view');assert.equal(await count(c,id.note),1);
 const revision=(await c.query('SELECT updated_at FROM notes WHERE id=$1',[id.note])).rows[0].updated_at.toISOString();
 await changeNoteGrant(c,id.note,id.target,'view',user);assert.equal(await count(c,id.note),1);assert.equal((await c.query('SELECT updated_at FROM notes WHERE id=$1',[id.note])).rows[0].updated_at.toISOString(),revision);
 await changeNoteGrant(c,id.note,id.target,'edit',user);assert.equal(await count(c,id.note),2);
 await changeNoteGrant(c,id.note,id.target,null,user);await changeNoteGrant(c,id.note,id.target,null,user);assert.equal(await count(c,id.note),3);assert.equal((await c.query("SELECT 1 FROM record_access_grants WHERE entity_type='note' AND entity_id=$1",[id.note])).rowCount,0);
}));
test('PostgreSQL note mandatory audit failure rolls back grant and revision',{skip:!enabled},()=>fixture(async(c,id,user)=>{
 const initial=(await c.query('SELECT updated_at FROM notes WHERE id=$1',[id.note])).rows[0].updated_at.toISOString();await c.query('SAVEPOINT before_failed_audit');const name=`p2_note_${id.actor.replaceAll('-','')}`;
 await c.query(`CREATE FUNCTION pg_temp.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'required note grant audit fixture'; END $$`);
 await c.query(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.entity_id='${id.note}'::uuid) EXECUTE FUNCTION pg_temp.${name}()`);
 await assert.rejects(changeNoteGrant(c,id.note,id.target,'view',user),/required note grant audit fixture/);await c.query('ROLLBACK TO SAVEPOINT before_failed_audit');
 assert.equal(await count(c,id.note),0);assert.equal((await c.query('SELECT updated_at FROM notes WHERE id=$1',[id.note])).rows[0].updated_at.toISOString(),initial);assert.equal((await c.query('SELECT 1 FROM record_access_grants WHERE entity_id=$1',[id.note])).rowCount,0);
}));
test('PostgreSQL note grant mutation rejects stale account, domain denial, target and changed scope',{skip:!enabled},()=>fixture(async(c,id,user)=>{
 await assert.rejects(changeNoteGrant(c,id.note,id.target,'view',{...user,credentialVersion:user.credentialVersion+1}),e=>e.code==='SESSION_REVOKED');
 await c.query('UPDATE users SET is_active=FALSE WHERE id=$1',[id.target]);await assert.rejects(changeNoteGrant(c,id.note,id.target,'view',user),e=>e.code==='GRANT_TARGET_INACTIVE');
 await c.query("UPDATE notes SET visibility='lab' WHERE id=$1",[id.note]);await assert.rejects(changeNoteGrant(c,id.note,id.target,'view',user),e=>e.code==='NOTE_NOT_RESTRICTED');
 await c.query("UPDATE notes SET visibility='restricted' WHERE id=$1",[id.note]);await c.query("UPDATE users SET role='viewer' WHERE id=$1",[id.actor]);await assert.rejects(changeNoteGrant(c,id.note,id.target,'view',user),e=>e.code==='PERMISSION_DENIED');assert.equal(await count(c,id.note),0);
}));
test('PostgreSQL note grants use transaction-bound project leadership and current role',{skip:!enabled},()=>fixture(async(c,id,user)=>{
 await c.query("UPDATE users SET role='researcher' WHERE id=$1",[id.actor]);await c.query("INSERT INTO projects(id,name,owner_id) VALUES($1,'Note grant project',$2)",[id.project,id.actor]);await c.query('UPDATE notes SET project_id=$1 WHERE id=$2',[id.project,id.note]);
 await changeNoteGrant(c,id.note,id.target,'view',user);assert.equal(await count(c,id.note),1);
 await c.query('UPDATE projects SET owner_id=$1 WHERE id=$2',[id.target,id.project]);await assert.rejects(changeNoteGrant(c,id.note,id.target,'edit',user),e=>e.code==='NOTE_GRANT_MANAGER_REQUIRED');assert.equal(await count(c,id.note),1);
}));
after(async()=>{if(enabled)await pool.end();});
