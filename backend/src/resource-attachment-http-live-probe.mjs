import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
if(process.env.LABOS_ATTACHMENT_SCOPE_HTTP_PROBE!=='1')throw Error('Explicit attachment-scope HTTP opt-in required');
assert.match((await pool.query('SELECT current_database() AS name')).rows[0].name,/^labos_phase2_acceptance_/);
const id=Object.fromEntries(['actor','project','source','target','resource','change'].map(k=>[k,randomUUID()]));
const name=`p2_attach_${id.actor.replaceAll('-','')}`,changes=[id.change];let trigger=false,fn=false,checks=0;
try {
 const owner=(await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','researcher') RETURNING credential_version",[id.actor,name])).rows[0];
 await pool.query("INSERT INTO projects(id,name,owner_id,visibility) VALUES($1,'Attachment scope fixture',$2,'restricted')",[id.project,id.actor]);
 await pool.query("INSERT INTO notes(id,title,body,project_id,visibility) VALUES($1,'Source','fixture',$3,'restricted'),($2,'Target','fixture',$3,'restricted')",[id.source,id.target,id.project]);
 for(const[type,entity]of [['project',id.project],['note',id.source],['note',id.target]])await pool.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES($1,$2,$3,'edit',$3)",[type,entity,id.actor]);
 const initial=(await pool.query("INSERT INTO resources(id,name,kind,file_type,url,note_id,uploaded_by,visibility) VALUES($1,'Attachment link','link','other','https://example.test/attachment',$2,$3,'lab') RETURNING *",[id.resource,id.source,id.actor])).rows[0];
 const token=jwt.sign({userId:id.actor,credentialVersion:owner.credential_version},config.jwtSecret,{expiresIn:'10m'});
 const event={change_id:id.change,entity_type:'resource',entity_id:id.resource,operation:'attach',payload:{id:id.resource,attachment:{protocol:1,expected_updated_at:initial.updated_at.toISOString(),destination:{item_id:null,project_id:null,note_id:id.target}}}};
 async function send(change,status){const response=await fetch('http://127.0.0.1:4000/api/sync/push',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({device_id:'scope-probe',changes:[change]})});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.results[0].status,status,JSON.stringify(body));checks++;return body.results[0];}
 await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'required attachment audit fixture'; END $$`);fn=true;
 await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.actor_user_id='${id.actor}'::uuid) EXECUTE FUNCTION ${name}()`);trigger=true;
 await send(event,'failed');
 const unchanged=(await pool.query('SELECT note_id,updated_at FROM resources WHERE id=$1',[id.resource])).rows[0];assert.equal(unchanged.note_id,id.source);assert.equal(unchanged.updated_at.toISOString(),initial.updated_at.toISOString());assert.equal((await pool.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[id.change])).rowCount,0);checks++;
 await pool.query(`DROP TRIGGER ${name} ON audit_log`);trigger=false;await pool.query(`DROP FUNCTION ${name}()`);fn=false;
 const ack=(await send(event,'synced')).result;assert.equal(ack.id,undefined);assert.equal(ack.acknowledged,true);assert.equal(ack.note_id,undefined);const moved=(await pool.query('SELECT * FROM resources WHERE id=$1',[id.resource])).rows[0];assert.equal(moved.note_id,id.target);checks++;
 await send(event,'synced');assert.equal((await pool.query('SELECT 1 FROM audit_log WHERE entity_id=$1',[id.resource])).rowCount,1);assert.equal((await pool.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[id.change])).rowCount,1);checks++;
 await pool.query("UPDATE record_access_grants SET access_level='view' WHERE entity_type='note' AND entity_id=$1 AND user_id=$2",[id.source,id.actor]);
 const rejected={...event,change_id:randomUUID(),payload:{...event.payload,attachment:{...event.payload.attachment,expected_updated_at:moved.updated_at.toISOString(),destination:{item_id:null,project_id:null,note_id:id.source}}}};changes.push(rejected.change_id);
 await send(rejected,'rejected');assert.equal((await pool.query('SELECT note_id FROM resources WHERE id=$1',[id.resource])).rows[0].note_id,id.target);assert.equal((await pool.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[rejected.change_id])).rowCount,0);checks++;
 console.log(JSON.stringify({status:'PASS',checks,scope:'routed PostgreSQL non-admin restricted-note move, mandatory audit/receipt rollback, original retry, exactly one audit, revoked destination rejection'}));
} catch(error) {console.error('Attachment probe failure:',error.message);throw error;} finally {
 if(trigger)await pool.query(`DROP TRIGGER IF EXISTS ${name} ON audit_log`);if(fn)await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
 await pool.query('DELETE FROM sync_idempotency WHERE change_id=ANY($1::text[])',[changes]);await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1',[id.actor]);
 await pool.query('DELETE FROM resources WHERE id=$1',[id.resource]);await pool.query('DELETE FROM record_access_grants WHERE entity_id=ANY($1::uuid[])',[[id.project,id.source,id.target]]);
 await pool.query('DELETE FROM notes WHERE id=ANY($1::uuid[])',[[id.source,id.target]]);await pool.query('DELETE FROM projects WHERE id=$1',[id.project]);await pool.query('DELETE FROM users WHERE id=$1',[id.actor]);await pool.end();
}
