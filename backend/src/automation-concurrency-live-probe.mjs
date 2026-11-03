// Isolated acceptance database only. Committed namespaced fixtures are cleaned
// explicitly so two actual connections can observe them and contend on locks.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
import {authenticateToken} from './middleware/auth.js';
import automation from './routes/automation.js';
if(process.env.LABOS_DEV_AUTOMATION_CONCURRENCY!=='isolated-fixtures'||!/^labos_phase2_acceptance_/.test(process.env.PGDATABASE||''))throw Error('Separate acceptance database and explicit isolated-fixtures opt-in required');
const actor=randomUUID(),project=randomUUID(),task=randomUUID(),runs=[randomUUID(),randomUUID()];
let server;
try{
 await pool.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'no-login','admin',true)",[actor,`automation-concurrency-${actor}`]);
 await pool.query("INSERT INTO projects(id,name,owner_id,visibility) VALUES($1,'Concurrent reminders fixture',$2,'restricted')",[project,actor]);
 await pool.query("INSERT INTO project_tasks(id,project_id,title,due_date,assignee_id) VALUES($1,$2,'Concurrent reminder',current_date,$3)",[task,project,actor]);
 const version=(await pool.query('SELECT credential_version FROM users WHERE id=$1',[actor])).rows[0].credential_version;
 const token=jwt.sign({userId:actor,credentialVersion:version},config.jwtSecret,{expiresIn:'5m'});
 const app=express();app.use(express.json());app.use('/automation',authenticateToken,automation);app.use((error,req,res,next)=>res.status(error.status||500).json({error:{code:error.code||'PROBE_ERROR'}}));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 async function run(id){const response=await fetch(`http://127.0.0.1:${server.address().port}/automation/run`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Idempotency-Key':id},signal:AbortSignal.timeout(45000)});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;}
 // Hold the production advisory lock on a third connection until both HTTP
 // handlers have reached it. This proves actual overlap, not sequential calls.
 const blocker=await pool.connect();
 let first,second,waiting=0;
 try{
  await blocker.query('BEGIN');await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended('automation-reminders',0))");
  const capture=promise=>promise.then(value=>({value}),error=>({error}));
  first=capture(run(runs[0]));second=capture(run(runs[1]));
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
   await blocker.query('SELECT pg_stat_clear_snapshot()');
   waiting=Number((await blocker.query("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%automation-reminders%' AND pid<>pg_backend_pid()")).rows[0].n);
   if(waiting>=2)break;await new Promise(resolve=>setTimeout(resolve,40));
  }

 }finally{await blocker.query('ROLLBACK');blocker.release();}
 const settled=await Promise.all([first,second]);for(const result of settled)if(result?.error)throw result.error;
 assert.equal(waiting,2,'Both real HTTP transactions must overlap at the reminder lock');
 const results=settled.map(result=>result.value);
 assert.equal(results.filter(result=>result.created===0).length,1);assert.equal(results.filter(result=>result.created>0).length,1);
 assert.equal((await pool.query('SELECT 1 FROM notifications WHERE entity_id=$1 AND user_id=$2',[task,actor])).rowCount,1);
 assert.equal((await pool.query('SELECT 1 FROM sync_idempotency WHERE change_id=ANY($1::text[])',[runs])).rowCount,2);
 assert.equal((await pool.query('SELECT 1 FROM audit_log WHERE entity_id=ANY($1::uuid[])',[runs])).rowCount,2);
 console.log('PASS: two actual overlapping HTTP/SQL transactions serialize distinct run IDs; one run creates reminders, one creates zero, with one notification per recipient/key and two atomic receipts/audits.');
}finally{
 if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 const cleanup=await pool.connect();
 try{
  await cleanup.query('BEGIN');
  await cleanup.query("DELETE FROM notifications WHERE metadata->>'automation_run_id'=ANY($1::text[])",[runs]);
  await cleanup.query('DELETE FROM sync_idempotency WHERE change_id=ANY($1::text[])',[runs]);
  await cleanup.query('DELETE FROM audit_log WHERE entity_id=ANY($1::uuid[])',[runs]);
  await cleanup.query('DELETE FROM project_tasks WHERE id=$1 AND project_id=$2',[task,project]);
  await cleanup.query('DELETE FROM projects WHERE id=$1 AND owner_id=$2',[project,actor]);
  await cleanup.query('DELETE FROM users WHERE id=$1 AND username=$2',[actor,`automation-concurrency-${actor}`]);
  await cleanup.query('COMMIT');
  assert.equal((await cleanup.query('SELECT 1 FROM users WHERE id=$1',[actor])).rowCount,0);
  assert.equal((await cleanup.query("SELECT 1 FROM notifications WHERE metadata->>'automation_run_id'=ANY($1::text[])",[runs])).rowCount,0);
  console.log('PASS: committed concurrency fixture and its tagged reminder effects removed from the separate acceptance database.');
 }catch(error){await cleanup.query('ROLLBACK');throw error;}finally{cleanup.release();await pool.end();}
}
