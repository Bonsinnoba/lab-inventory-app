// Production routers/auth, actual PostgreSQL, rollback-only fixtures/effects.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
import {authenticateToken} from './middleware/auth.js';
import automation from './routes/automation.js';
import sync from './routes/sync.js';
if(process.env.LABOS_DEV_AUTOMATION_PROBE!=='rollback-only')throw Error('Explicit rollback-only opt-in required');
const c=await pool.connect(),originalQuery=pool.query,originalConnect=pool.connect;
const actor=randomUUID(),reader=randomUUID(),outsider=randomUUID(),project=randomUUID(),task=randomUUID(),privateTask=randomUUID();
let server,active=false,failAt=null,demote=false;
try{
 await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='15s'");
 for(const [id,role] of [[actor,'admin'],[reader,'researcher'],[outsider,'viewer']])await c.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'no-login',$3,true)",[id,`automation-${id}`,role]);
 await c.query("INSERT INTO projects(id,name,owner_id,visibility) VALUES($1,'Private automation fixture',$2,'restricted')",[project,actor]);
 await c.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level) VALUES('project',$1,$2,'view')",[project,reader]);
 await c.query("INSERT INTO project_tasks(id,project_id,title,due_date,assignee_id) VALUES($1,$3,'Reader reminder',current_date,$4),($2,$3,'Secret reminder',current_date,$5)",[task,privateTask,project,reader,outsider]);
 const legacyItem=randomUUID();
 await c.query("INSERT INTO items(id,name,type,status,next_maintenance_date) VALUES($1,'Legacy reminder fixture','component','available',current_date)",[legacyItem]);
 const legacyDate=(await c.query('SELECT next_maintenance_date FROM items WHERE id=$1',[legacyItem])).rows[0].next_maintenance_date;
 await c.query("INSERT INTO notifications(user_id,type,title,body,entity_type,entity_id,metadata) VALUES($1,'maintenance_due','Legacy reminder','fixture','item',$2,$3)",[reader,legacyItem,JSON.stringify({reminder_key:`maintenance:${legacyItem}:${legacyDate}`})]);
 pool.query=(...args)=>c.query(...args);
 pool.connect=async()=>({async query(sql,args){
  if(sql==='BEGIN'){assert.equal(active,false);await c.query('SAVEPOINT automation_route');active=true;if(demote)await c.query("UPDATE users SET role='viewer' WHERE id=$1",[actor]);return;}
  if(sql==='COMMIT'){await c.query('RELEASE SAVEPOINT automation_route');active=false;return;}
  if(sql==='ROLLBACK'){if(active){await c.query('ROLLBACK TO SAVEPOINT automation_route');await c.query('RELEASE SAVEPOINT automation_route');active=false;}return;}
  if(failAt==='audit'&&sql.includes('INSERT INTO audit_log')||failAt==='receipt'&&sql.startsWith('INSERT INTO sync_idempotency'))return c.query('SELECT 1/0');
  return c.query(sql,args);
 },release(){assert.equal(active,false);}});
 const app=express();app.use(express.json());app.use('/automation',authenticateToken,automation);app.use('/sync',authenticateToken,sync);
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:{code:error.code||'PROBE_ERROR'}}));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const version=(await c.query('SELECT credential_version FROM users WHERE id=$1',[actor])).rows[0].credential_version;
 const token=jwt.sign({userId:actor,credentialVersion:version},config.jwtSecret,{expiresIn:'5m'}),key=randomUUID();
 async function request(path,status,body,runId=key){const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Idempotency-Key':runId,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}
 const before=Number((await c.query('SELECT count(*) AS n FROM notifications')).rows[0].n);
 for(const failure of ['audit','receipt']){failAt=failure;await request('/automation/run',500);failAt=null;assert.equal(Number((await c.query('SELECT count(*) AS n FROM notifications')).rows[0].n),before);assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[key])).rowCount,0);}
 const first=await request('/automation/run',200);assert.equal(first.executed,true);assert.ok(first.created>=1);assert.deepEqual(await request('/automation/run',200),first);
 assert.equal((await c.query('SELECT 1 FROM notifications WHERE entity_id=$1 AND user_id=$2',[task,reader])).rowCount,1);
 assert.equal((await c.query('SELECT 1 FROM notifications WHERE entity_id=$1 AND user_id=$2',[legacyItem,reader])).rowCount,1);
 assert.equal((await c.query('SELECT 1 FROM notifications WHERE entity_id=$1 AND user_id=$2',[privateTask,outsider])).rowCount,0);
 assert.equal((await request('/automation/run',200,null,randomUUID())).created,0);
 demote=true;await request('/automation/run',403);demote=false;
 const run=randomUUID(),change={change_id:run,entity_type:'automation_run',entity_id:run,operation:'run',payload:{run_id:run}},body={device_id:randomUUID(),changes:[change]};
 failAt='receipt';assert.equal((await request('/sync/push',200,body)).results[0].status,'failed');failAt=null;
 assert.equal((await c.query('SELECT 1 FROM audit_log WHERE entity_id=$1',[run])).rowCount,0);
 const pushed=(await request('/sync/push',200,body)).results[0];assert.equal(pushed.status,'synced');assert.equal(pushed.result.executed,true);assert.equal(pushed.result.run_id,run);assert.equal(pushed.result.created,0);assert.deepEqual((await request('/sync/push',200,body)).results[0],pushed);
 assert.equal((await c.query('SELECT 1 FROM audit_log WHERE entity_id=$1',[run])).rowCount,1);
 console.log('PASS: actual PostgreSQL HTTP/outbox reminder replay, cross-run deduplication, private-recipient filtering, current authority and SQL audit/receipt rollback.');
}finally{
 if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});pool.query=originalQuery;pool.connect=originalConnect;
 try{await c.query('ROLLBACK');assert.equal((await c.query('SELECT 1 FROM users WHERE id=$1',[actor])).rowCount,0);assert.equal((await c.query('SELECT 1 FROM projects WHERE id=$1',[project])).rowCount,0);console.log('PASS: automation fixtures/effects rolled back.');}finally{c.release();await pool.end();}
}
