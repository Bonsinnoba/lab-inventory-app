// Isolated loopback HTTP harness: production auth/router, development PostgreSQL,
// one rollback-only transaction. Not a deployed-server or concurrency test.
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {config} from './config.js';
import {authenticateToken} from './middleware/auth.js';
import syncRouter from './routes/sync.js';

if(process.env.LABOS_DEV_PROJECT_HTTP_PROBE!=='rollback-only')throw Error('Explicit rollback-only development opt-in required');
const c=await pool.connect(),originalQuery=pool.query,originalConnect=pool.connect;
const user=randomUUID(),lab=randomUUID(),restricted=randomUUID();
const device=randomUUID(),task=randomUUID(),failedTask=randomUUID();
let server;
try{
 await c.query('BEGIN');
 await c.query("SET LOCAL statement_timeout='15s'");
 await c.query("SET LOCAL lock_timeout='1s'");
 await c.query("INSERT INTO users(id,username,password_hash,role,is_active,credential_version) VALUES($1,$2,$3,'viewer',true,0)",[user,`rollback-http-${user}`,randomUUID()]);
 await c.query("INSERT INTO projects(id,name,owner_id,visibility) VALUES($1,'Rollback HTTP lab',$3,'lab'),($2,'Rollback HTTP restricted',$3,'restricted')",[lab,restricted,user]);
 // Keep every production pool read inside this isolated transaction. No fake
 // query results: SQL executes against the real database. No production listener.
 pool.query=(...args)=>c.query(...args);
 const app=express();app.use(express.json());app.use('/api/sync',authenticateToken,syncRouter);
 app.use((err,req,res,next)=>res.status(err.status||500).json({error:{code:err.code||'PROBE_ERROR',message:err.message}}));
 server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
 const url=`http://127.0.0.1:${server.address().port}/api/sync/projects/pull`;
 const token=jwt.sign({userId:user,role:'admin',credentialVersion:0},config.jwtSecret,{expiresIn:'5m'});
 async function request(bearer,status){
  const response=await fetch(url,{headers:bearer?{Authorization:`Bearer ${bearer}`}:{},signal:AbortSignal.timeout(20000)});
  const body=await response.json();
  assert.equal(response.status,status,`Unexpected HTTP status: ${body.error?.code||'response'}`);return body;
 }
 await request(null,401);
 await request('invalid',401);
 await request(jwt.sign({userId:user,credentialVersion:0},config.jwtSecret,{expiresIn:-1}),401);
 await c.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,'projects.view','deny')",[user]);
 await request(token,403);
 await c.query("DELETE FROM user_permission_overrides WHERE user_id=$1 AND permission='projects.view'",[user]);
 let body=await request(token,200);
 assert.ok(body.visible_project_ids.includes(lab));assert.ok(!body.visible_project_ids.includes(restricted),'JWT role must not override database role');
 assert.ok(body.projects.every(project=>body.visible_project_ids.includes(project.id)));
 await c.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level) VALUES('project',$1,$2,'view')",[restricted,user]);
 body=await request(token,200);assert.ok(body.visible_project_ids.includes(restricted));
 await c.query("DELETE FROM record_access_grants WHERE entity_type='project' AND entity_id=$1 AND user_id=$2",[restricted,user]);
 body=await request(token,200);assert.ok(!body.visible_project_ids.includes(restricted));
 await c.query('UPDATE users SET credential_version=1 WHERE id=$1',[user]);
 assert.equal((await request(token,401)).error.code,'SESSION_REVOKED');
 const current=jwt.sign({userId:user,credentialVersion:1},config.jwtSecret,{expiresIn:'5m'});
 await c.query('UPDATE users SET is_active=false WHERE id=$1',[user]);
 assert.equal((await request(current,401)).error.code,'ACCOUNT_DISABLED');
 console.log('PASS: 9 HTTP cases using production authentication and project-pull router: missing/invalid/expired JWT, domain denial, DB-role precedence, grant/revocation, credential reset and disabled account.');
 if(process.env.LABOS_DEV_PROJECT_WRITE_PROBE==='rollback-only'){
  await c.query("UPDATE users SET is_active=true,role='admin' WHERE id=$1",[user]);
  const version=(await c.query('SELECT credential_version FROM users WHERE id=$1',[user])).rows[0].credential_version;
  let writeToken=jwt.sign({userId:user,credentialVersion:version},config.jwtSecret,{expiresIn:'5m'});
  let active=false,failReceipt=false,failAudit=false;
  const routeClient={async query(sql,args){
   if(sql==='BEGIN'){assert.equal(active,false);await c.query('SAVEPOINT write_route');active=true;return;}
   if(sql==='COMMIT'){await c.query('RELEASE SAVEPOINT write_route');active=false;return;}
   if(sql==='ROLLBACK'){if(active){await c.query('ROLLBACK TO SAVEPOINT write_route');await c.query('RELEASE SAVEPOINT write_route');active=false;}return;}
   if(failAudit&&sql.includes('INSERT INTO audit_log'))return c.query('SELECT 1/0');
   if(failReceipt&&sql.startsWith('INSERT INTO sync_idempotency'))throw Object.assign(Error('Injected receipt failure'),{code:'PROBE_RECEIPT_FAILURE'});
   return c.query(sql,args);
  },release(){assert.equal(active,false);}};
  pool.connect=async()=>routeClient;
  async function push(change,deviceId=device){
   const response=await fetch(url.replace('/projects/pull','/push'),{method:'POST',headers:{Authorization:`Bearer ${writeToken}`,'Content-Type':'application/json'},body:JSON.stringify({device_id:deviceId,changes:[change]}),signal:AbortSignal.timeout(20000)});
   assert.equal(response.status,200);return (await response.json()).results[0];
  }
  const make=(operation,record,entity=task)=>({change_id:randomUUID(),entity_type:'project_task',entity_id:entity,operation,payload:{project_id:lab,record:{id:entity,project_id:lab,...record}}});
  const create=make('create',{title:'Rollback task'});
  failAudit=true;assert.equal((await push(create)).status,'failed');failAudit=false;
  assert.equal((await c.query('SELECT 1 FROM project_tasks WHERE id=$1',[task])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[create.change_id])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM audit_log WHERE entity_id=$1',[task])).rowCount,0);
  const first=await push(create);assert.equal(first.status,'synced');assert.deepEqual(await push(create),first);
  assert.equal((await c.query('SELECT 1 FROM project_tasks WHERE id=$1',[task])).rowCount,1);
  assert.equal((await c.query("SELECT 1 FROM audit_log WHERE entity_id=$1 AND action='sync:create'",[task])).rowCount,1);
  const altered=structuredClone(create);altered.payload.record.title='Different retry';
  assert.equal((await push(altered)).error.code,'IDEMPOTENCY_PAYLOAD_MISMATCH');
  assert.equal((await push(create,randomUUID())).error.code,'IDEMPOTENCY_OWNERSHIP_MISMATCH');
  const update=make('update',{title:'Updated rollback task'});
  failAudit=true;assert.equal((await push(update)).status,'failed');failAudit=false;
  assert.equal((await c.query('SELECT title FROM project_tasks WHERE id=$1',[task])).rows[0].title,'Rollback task');
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[update.change_id])).rowCount,0);
  const updated=await push(update);assert.equal(updated.status,'synced');assert.deepEqual(await push(update),updated);
  assert.equal((await c.query('SELECT title FROM project_tasks WHERE id=$1',[task])).rows[0].title,'Updated rollback task');
  const remove=make('delete',{});
  failAudit=true;assert.equal((await push(remove)).status,'failed');failAudit=false;
  assert.equal((await c.query('SELECT 1 FROM project_tasks WHERE id=$1',[task])).rowCount,1);
  assert.equal((await c.query("SELECT 1 FROM sync_tombstones WHERE entity_type='project_task' AND entity_id=$1",[task])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[remove.change_id])).rowCount,0);
  const removed=await push(remove);assert.equal(removed.status,'synced');assert.deepEqual(await push(remove),removed);
  assert.equal((await c.query('SELECT 1 FROM project_tasks WHERE id=$1',[task])).rowCount,0);
  assert.equal((await c.query("SELECT 1 FROM sync_tombstones WHERE entity_type='project_task' AND entity_id=$1",[task])).rowCount,1);
  assert.equal((await c.query("SELECT 1 FROM audit_log WHERE entity_id=$1 AND action IN ('sync:create','sync:update','sync:delete')",[task])).rowCount,3);
  const fault=make('create',{title:'Must roll back'},failedTask);
  failReceipt=true;
  assert.equal((await push(fault)).status,'failed');failReceipt=false;
  assert.equal((await c.query('SELECT 1 FROM project_tasks WHERE id=$1',[failedTask])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[fault.change_id])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM audit_log WHERE entity_id=$1',[failedTask])).rowCount,0);
  assert.equal((await push(fault)).status,'synced');
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE device_id=$1',[device])).rowCount,4);
  console.log('PASS: task create/update/delete replay, payload/device mismatch rejection, one tombstone, atomic receipt-failure rollback and same-event retry recovery. Four unique receipts.');
  await c.query("UPDATE projects SET budget=100,description='Baseline' WHERE id=$1",[lab]);
  const before=(await c.query('SELECT * FROM projects WHERE id=$1',[lab])).rows[0];
  await c.query('UPDATE projects SET budget=150 WHERE id=$1',[lab]);
  await c.query("UPDATE users SET role='researcher' WHERE id=$1",[user]);
  const researcherVersion=(await c.query('SELECT credential_version FROM users WHERE id=$1',[user])).rows[0].credential_version;
  writeToken=jwt.sign({userId:user,credentialVersion:researcherVersion},config.jwtSecret,{expiresIn:'5m'});
  const projectChange={change_id:randomUUID(),entity_type:'project',entity_id:lab,operation:'update',payload:{before,project:{...before,description:'Authored prose'}}};
  const projectResult=await push(projectChange);assert.equal(projectResult.status,'synced');
  assert.deepEqual(await push(projectChange),projectResult);
  const budgetChange={...projectChange,change_id:randomUUID(),payload:{before:{...before,budget:150,description:'Authored prose'},project:{...before,description:'Authored prose',budget:200}}};
  assert.equal((await push(budgetChange)).error.code,'PERMISSION_DENIED');
  const conflict={...projectChange,change_id:randomUUID(),payload:{before,project:{...before,description:'Conflicting prose'}}};
  assert.equal((await push(conflict)).error.code,'PROJECT_EDIT_CONFLICT');
  const stored=(await c.query('SELECT description,budget FROM projects WHERE id=$1',[lab])).rows[0];
  assert.equal(stored.description,'Authored prose');assert.equal(Number(stored.budget),150);
  console.log('PASS: project prose edit and replay without finance.edit; actual budget change denied; conflicting prose preserved for resolution.');
 }
 console.log('Not verified: login/password flow, deployed listener/config, concurrent transactions, other entity write receipts or desktop offline/reconnect.');
}finally{
 if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 pool.query=originalQuery;
 pool.connect=originalConnect;
 try{
  await c.query('ROLLBACK');
  for(const [sql,args] of [
   ['SELECT 1 FROM users WHERE id=$1',[user]],
   ['SELECT 1 FROM projects WHERE id=ANY($1::uuid[])',[[lab,restricted]]],
   ['SELECT 1 FROM user_permission_overrides WHERE user_id=$1',[user]],
   ['SELECT 1 FROM record_access_grants WHERE user_id=$1',[user]],
   ['SELECT 1 FROM project_tasks WHERE id=ANY($1::uuid[])',[[task,failedTask]]],
   ['SELECT 1 FROM sync_idempotency WHERE device_id=$1',[device]],
   ['SELECT 1 FROM sync_tombstones WHERE entity_id=ANY($1::uuid[])',[[task,failedTask]]]
  ])assert.equal((await c.query(sql,args)).rowCount,0,'HTTP fixture survived rollback');
  console.log('PASS: all HTTP fixtures absent after rollback.');
 }finally{c.release();await pool.end();}
}
