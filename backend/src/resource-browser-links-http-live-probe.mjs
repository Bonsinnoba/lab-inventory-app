import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
if(process.env.LABOS_BROWSER_LINKS_PROBE!=='1')throw Error('Explicit browser links probe opt-in required');
if(!(await pool.query('SELECT current_database() AS name')).rows[0].name.startsWith('labos_phase2_acceptance_'))throw Error('Isolated acceptance database required');
const actor=randomUUID(),name=`p2_links_${actor.replaceAll('-','')}`,url=`https://example.test/${actor}`;
let trigger=false,fn=false,checks=0;
try{
 const owner=(await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','viewer') RETURNING credential_version",[actor,name])).rows[0];
 await pool.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,'resources.create','grant')",[actor]);
 const token=jwt.sign({userId:actor,credentialVersion:owner.credential_version},config.jwtSecret,{expiresIn:'10m'});
 async function link(body,status){const response=await fetch('http://127.0.0.1:4000/api/resources/link',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const reply=await response.json();assert.equal(response.status,status,JSON.stringify(reply));return reply;}
 const created=await link({url,name:'Reviewed title'},201);assert.equal(created.name,'Reviewed title');assert.equal(created.name_source,'user');checks++;
 const retry=await link({url:url+'/',name:'A retry must not overwrite'},200);assert.equal(retry.id,created.id);assert.equal(retry.name,'Reviewed title');checks++;
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM audit_log WHERE entity_id=$1',[created.id])).rows[0].n,1);checks++;
 const fallback=await link({url:url+'/fallback'},201);assert.equal(fallback.name_source,'url_fallback');assert.equal(fallback.name,url+'/fallback');checks++;
 await link({url:'file:///C:/private'},400);checks++;
 await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'required browser link audit fixture'; END $$`);fn=true;
 await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.actor_user_id='${actor}'::uuid) EXECUTE FUNCTION ${name}()`);trigger=true;
 await link({url:url+'/audit'},500);assert.equal((await pool.query('SELECT 1 FROM resources WHERE url=$1',[url+'/audit'])).rowCount,0);checks++;
 await pool.query(`DROP TRIGGER ${name} ON audit_log`);trigger=false;await pool.query(`DROP FUNCTION ${name}()`);fn=false;
 const recovered=await link({url:url+'/audit'},201);const replay=await link({url:url+'/audit'},200);assert.equal(recovered.id,replay.id);checks++;
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM audit_log WHERE entity_id=$1',[recovered.id])).rows[0].n,1);checks++;
 await pool.query("UPDATE resources SET visibility='restricted' WHERE id=$1",[created.id]);
 await link({url},403);checks++;
 const identity=randomUUID(),event={change_id:randomUUID(),entity_type:'resource',entity_id:identity,operation:'create',payload:{resource:{id:identity,kind:'link',name:url,url}}};
 const sync=await fetch('http://127.0.0.1:4000/api/sync/push',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({device_id:randomUUID(),changes:[event]})});
 assert.equal(sync.status,200);const rejected=(await sync.json()).results[0];assert.equal(rejected.status,'rejected');assert.equal(rejected.error.code,'RESOURCE_ACCESS_REQUIRED');
 assert.equal((await pool.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[event.change_id])).rowCount,0);checks++;
 await pool.query("UPDATE user_permission_overrides SET effect='deny' WHERE user_id=$1 AND permission='resources.create'",[actor]);
 await link({url:url+'/revoked'},403);assert.equal((await pool.query('SELECT 1 FROM resources WHERE url=$1',[url+'/revoked'])).rowCount,0);checks++;
 await pool.query('UPDATE users SET credential_version=credential_version+1 WHERE id=$1',[actor]);await link({url:url+'/reset'},401);checks++;
 console.log(JSON.stringify({status:'PASS',checks,scope:'browser link title provenance, same-context retry deduplication, mandatory audit rollback, visibility denial and current actor revocation'}));
}finally{
 if(trigger)await pool.query(`DROP TRIGGER IF EXISTS ${name} ON audit_log`);if(fn)await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
 await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1',[actor]);await pool.query('DELETE FROM resources WHERE uploaded_by=$1',[actor]);await pool.query('DELETE FROM user_permission_overrides WHERE user_id=$1',[actor]);await pool.query('DELETE FROM users WHERE id=$1',[actor]);await pool.end();
}
