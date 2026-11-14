import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';

if(process.env.LABOS_NONFILE_AUDIT_HTTP_PROBE!=='1')throw Error('Explicit nonfile audit probe opt-in required');
if(!(await pool.query('SELECT current_database() AS name')).rows[0].name.startsWith('labos_phase2_acceptance_'))throw Error('Isolated acceptance database required');
const actor=randomUUID(),device=randomUUID(),resources=[randomUUID(),randomUUID()],changes=[randomUUID(),randomUUID()];
const fixture=`p2_nonfile_audit_${actor.replaceAll('-','')}`;
let triggerCreated=false,functionCreated=false,checks=0;
try{
 const user=(await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','admin') RETURNING credential_version",[actor,fixture])).rows[0];
 const token=jwt.sign({userId:actor,credentialVersion:user.credential_version},config.jwtSecret,{expiresIn:'5m'});
 const events=resources.map((id,index)=>({change_id:changes[index],entity_type:'resource',entity_id:id,operation:'create',payload:{resource:{id,name:`Audit ${index}`,name_source:'user',kind:index?'link':'folder',...(index?{url:`https://example.test/${fixture}`,file_type:'other'}:{}),visibility:'lab',category:'general',description:'',tags:[]}}}));
 async function push(){
  const response=await fetch('http://127.0.0.1:4000/api/sync/push',{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({device_id:device,changes:events})});
  assert.equal(response.status,200);return response.json();
 }
 // The trigger affects only these disposable identities in the isolated DB.
 await pool.query(`CREATE FUNCTION ${fixture}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'nonfile required audit fixture'; END $$`);functionCreated=true;
 await pool.query(`CREATE TRIGGER ${fixture} BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.entity_id IN ('${resources[0]}'::uuid,'${resources[1]}'::uuid)) EXECUTE FUNCTION ${fixture}()`);triggerCreated=true;
 const failed=await push();assert.equal(failed.results.length,2);
 assert.ok(failed.results.every(row=>row.status==='failed'&&row.error.message.includes('nonfile required audit fixture')));checks++;
 for(const [table,field,ids] of [['resources','id',resources],['sync_idempotency','change_id',changes],['audit_log','entity_id',resources]]){
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${field}::text=ANY($1::text[])`,[ids])).rows[0].count,0);checks++;
 }
 await pool.query(`DROP TRIGGER ${fixture} ON audit_log`);triggerCreated=false;
 await pool.query(`DROP FUNCTION ${fixture}()`);functionCreated=false;
 for(let attempt=0;attempt<2;attempt++){
  const reply=await push();assert.ok(reply.results.every(row=>row.status==='synced'&&row.result.acknowledged===true));checks++;
  assert.ok(reply.results.every(row=>row.result.name===undefined&&row.result.url===undefined&&row.result.storage_path===undefined));checks++;
 }
 for(const [table,field,ids] of [['resources','id',resources],['sync_idempotency','change_id',changes],['audit_log','entity_id',resources]]){
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${field}::text=ANY($1::text[])`,[ids])).rows[0].count,2);checks++;
 }
 console.log(JSON.stringify({checks,status:'PASS',scope:'HTTP link/folder create, required-audit rollback, same-event retry/replay, one audit per create, minimal receipts'}));
}finally{
 if(triggerCreated)await pool.query(`DROP TRIGGER IF EXISTS ${fixture} ON audit_log`);
 if(functionCreated)await pool.query(`DROP FUNCTION IF EXISTS ${fixture}()`);
 await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1',[actor]);
 await pool.query('DELETE FROM sync_idempotency WHERE user_id=$1',[actor]);
 await pool.query('DELETE FROM resources WHERE id=ANY($1::uuid[])',[resources]);
 await pool.query('DELETE FROM users WHERE id=$1',[actor]);
 await pool.end();
}
