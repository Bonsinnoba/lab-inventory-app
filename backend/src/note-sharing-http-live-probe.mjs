import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
if(process.env.LABOS_NOTE_SHARING_HTTP_PROBE!=='1')throw Error('Explicit note sharing HTTP probe opt-in required');
assert.match((await pool.query('SELECT current_database() AS name')).rows[0].name,/^labos_phase2_acceptance_/);
const actor=randomUUID(),recipient=randomUUID(),resource=randomUUID(),name=`p2_note_sharing_${actor.replaceAll('-','')}`;let fn=false,trigger=false,checks=0;
try{
 const owner=(await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','admin') RETURNING credential_version",[actor,name])).rows[0];await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','viewer')",[recipient,name+'_recipient']);await pool.query("INSERT INTO notes(id,title,body,author_id,visibility) VALUES($1,'HTTP sharing fixture','fixture',$2,'restricted')",[resource,actor]);const token=jwt.sign({userId:actor,credentialVersion:owner.credential_version},config.jwtSecret,{expiresIn:'10m'});
 async function request(path,method,body,status){const response=await fetch(`http://127.0.0.1:4000/api/notes/${resource}${path}`,{method,signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=response.status===204?null:await response.json();assert.equal(response.status,status,JSON.stringify(value));checks++;return value;}
 const audits=async()=>Number((await pool.query('SELECT count(*) AS n FROM audit_log WHERE entity_id=$1',[resource])).rows[0].n);
 assert.equal(await audits(),0);checks++;
 const results=await Promise.all([request(`/access-grants/${recipient}`,'PUT',{access_level:'view'},200),request(`/access-grants/${recipient}`,'PUT',{access_level:'view'},200)]);assert.ok(results.every(row=>row.user_id===recipient&&row.access_level==='view'));assert.equal(await audits(),1);checks++;
 const revision=(await pool.query('SELECT updated_at FROM notes WHERE id=$1',[resource])).rows[0].updated_at.toISOString();await request(`/access-grants/${recipient}`,'PUT',{access_level:'view'},200);assert.equal(await audits(),1);assert.equal((await pool.query('SELECT updated_at FROM notes WHERE id=$1',[resource])).rows[0].updated_at.toISOString(),revision);checks++;
 await Promise.all([request(`/access-grants/${recipient}`,'DELETE',undefined,204),request(`/access-grants/${recipient}`,'DELETE',undefined,204)]);assert.equal(await audits(),2);checks++;

 const before=(await pool.query('SELECT updated_at FROM notes WHERE id=$1',[resource])).rows[0].updated_at.toISOString();await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'required routed sharing audit fixture'; END $$`);fn=true;await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.actor_user_id='${actor}'::uuid) EXECUTE FUNCTION ${name}()`);trigger=true;
 await request(`/access-grants/${recipient}`,'PUT',{access_level:'view'},500);const rolledBack=(await pool.query('SELECT visibility,updated_at FROM notes WHERE id=$1',[resource])).rows[0];assert.equal(rolledBack.visibility,'restricted');assert.equal(rolledBack.updated_at.toISOString(),before);assert.equal(await audits(),2);assert.equal((await pool.query('SELECT 1 FROM record_access_grants WHERE entity_id=$1',[resource])).rowCount,0);checks++;
 await pool.query(`DROP TRIGGER ${name} ON audit_log`);trigger=false;await pool.query(`DROP FUNCTION ${name}()`);fn=false;
 await pool.query('UPDATE users SET is_active=FALSE WHERE id=$1',[recipient]);await request(`/access-grants/${recipient}`,'PUT',{access_level:'edit'},400);checks++;
 await pool.query("UPDATE users SET role='viewer' WHERE id=$1",[actor]);await request(`/access-grants/${recipient}`,'DELETE',undefined,403);assert.equal((await pool.query('SELECT visibility FROM notes WHERE id=$1',[resource])).rows[0].visibility,'restricted');checks++;
 await pool.query("UPDATE users SET role='admin',credential_version=credential_version+1 WHERE id=$1",[actor]);await request(`/access-grants/${recipient}`,'DELETE',undefined,401);assert.equal(await audits(),2);checks++;
 console.log(JSON.stringify({status:'PASS',checks,scope:'actual PostgreSQL/HTTP note sharing, concurrent identical writes, lost-response retries, mandatory audit rollback, target state and current actor revocation'}));
}finally{
 if(trigger)await pool.query(`DROP TRIGGER IF EXISTS ${name} ON audit_log`);if(fn)await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1',[actor]);await pool.query("DELETE FROM record_access_grants WHERE entity_type='note' AND entity_id=$1",[resource]);await pool.query('DELETE FROM notes WHERE id=$1',[resource]);await pool.query('DELETE FROM user_permission_overrides WHERE user_id=ANY($1::uuid[])',[[actor,recipient]]);await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[actor,recipient]]);await pool.end();
}
