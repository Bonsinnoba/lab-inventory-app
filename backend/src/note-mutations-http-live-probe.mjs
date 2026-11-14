import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
if(process.env.LABOS_NOTE_MUTATION_HTTP_PROBE!=='1')throw Error('Explicit note mutation HTTP probe opt-in required');
assert.match((await pool.query('SELECT current_database() AS name')).rows[0].name,/^labos_phase2_acceptance_/);
const actor=randomUUID(),name=`p2_notes_${actor.replaceAll('-','')}`;let noteId,trigger=false,fn=false,checks=0;
try{
 const owner=(await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','admin') RETURNING credential_version",[actor,name])).rows[0];
 const token=jwt.sign({userId:actor,credentialVersion:owner.credential_version},config.jwtSecret,{expiresIn:'10m'});
 async function request(path,method,body,status){const response=await fetch(`http://127.0.0.1:4000/api/notes${path}`,{method,signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=response.status===204?null:await response.json();assert.equal(response.status,status,JSON.stringify(value));checks++;return value;}
 async function snapshot(){return (await pool.query(`SELECT row_to_json(n) AS note,(SELECT count(*)::int FROM note_revisions WHERE note_id=n.id) AS revisions,(SELECT count(*)::int FROM audit_log WHERE entity_id=n.id) AS audits,(SELECT count(*)::int FROM sync_tombstones WHERE entity_type='note' AND entity_id=n.id) AS tombstones FROM notes n WHERE id=$1`,[noteId])).rows[0];}
 const created=await request('','POST',{title:name,body:'original',visibility:'restricted'},201);noteId=created.id;assert.equal(created.author_id,actor);checks++;
 await request(`/${noteId}`,'PUT',{title:name+' edited',body:'edited'},200);
 const revision=(await pool.query('SELECT id FROM note_revisions WHERE note_id=$1 ORDER BY created_at LIMIT 1',[noteId])).rows[0].id;
 const before=await snapshot();assert.equal(before.revisions,1);assert.equal(before.audits,2);checks++;
 await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'required note mutation audit fixture'; END $$`);fn=true;
 await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.actor_user_id='${actor}'::uuid) EXECUTE FUNCTION ${name}()`);trigger=true;
 await request('','POST',{title:name+' rejected',body:'must roll back',visibility:'restricted'},500);
 assert.equal((await pool.query('SELECT 1 FROM notes WHERE author_id=$1',[actor])).rowCount,1);checks++;
 for(const[path,method,body]of [[`/${noteId}`,'PUT',{body:'must roll back',visibility:'lab'}],[`/${noteId}/revisions/${revision}/restore`,'POST',{}],[`/${noteId}`,'DELETE',undefined]]){
  await request(path,method,body,500);assert.deepEqual(await snapshot(),before);checks++;
 }
 assert.equal((await pool.query("SELECT 1 FROM record_access_grants WHERE entity_type='note' AND entity_id=$1 AND user_id=$2",[noteId,actor])).rowCount,1);checks++;
 await pool.query(`DROP TRIGGER ${name} ON audit_log`);trigger=false;await pool.query(`DROP FUNCTION ${name}()`);fn=false;
 const restored=await request(`/${noteId}/revisions/${revision}/restore`,'POST',{},200);assert.equal(restored.body,'original');checks++;
 await request(`/${noteId}`,'DELETE',undefined,204);assert.equal((await pool.query('SELECT 1 FROM notes WHERE id=$1',[noteId])).rowCount,0);assert.equal((await pool.query("SELECT 1 FROM sync_tombstones WHERE entity_type='note' AND entity_id=$1",[noteId])).rowCount,1);assert.equal((await pool.query("SELECT 1 FROM record_access_grants WHERE entity_type='note' AND entity_id=$1",[noteId])).rowCount,0);assert.equal(Number((await pool.query('SELECT count(*) AS n FROM audit_log WHERE entity_id=$1',[noteId])).rows[0].n),4);checks++;
 console.log(JSON.stringify({status:'PASS',checks,scope:'actual PostgreSQL/routed note create, edit, revision restore, delete, mandatory audit rollback including revisions/grants/tombstone, current author'}));
}finally{
 if(trigger)await pool.query(`DROP TRIGGER IF EXISTS ${name} ON audit_log`);if(fn)await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
 await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1',[actor]);if(noteId){await pool.query("DELETE FROM record_access_grants WHERE entity_type='note' AND entity_id=$1",[noteId]);await pool.query("DELETE FROM sync_tombstones WHERE entity_type='note' AND entity_id=$1",[noteId]);await pool.query('DELETE FROM note_revisions WHERE note_id=$1',[noteId]);}
 await pool.query('DELETE FROM notes WHERE author_id=$1',[actor]);await pool.query('DELETE FROM users WHERE id=$1',[actor]);await pool.end();
}
