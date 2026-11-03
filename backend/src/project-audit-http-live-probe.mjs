// Production routes + real PostgreSQL. All fixtures and route effects roll back.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
import {authenticateToken} from './middleware/auth.js';
import projectsRouter from './routes/projects.js';
import syncRouter from './routes/sync.js';

if(process.env.LABOS_DEV_PROJECT_AUDIT_PROBE!=='rollback-only')throw Error('Explicit development rollback-only opt-in required');
const c=await pool.connect(),originalQuery=pool.query,originalConnect=pool.connect;
const actor=randomUUID(),project=randomUUID(),deletable=randomUUID(),item=randomUUID(),reservation=randomUUID();
const childTask=randomUUID(),reader=randomUUID(),outsider=randomUUID();
let server,routeActive=false,failAudit=false,failReceipt=false;
try{
 await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='10s'");
 await c.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'no-login','admin',true)",[actor,`project-audit-${actor}`]);
 await c.query("INSERT INTO projects(id,name,owner_id,status) VALUES($1,'Audit rollback active',$3,'active'),($2,'Audit rollback deletion',$3,'planning')",[project,deletable,actor]);
 await c.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'no-login','viewer',true),($3,$4,'no-login','viewer',true)",[reader,`deletion-reader-${reader}`,outsider,`deletion-outsider-${outsider}`]);
 await c.query("UPDATE projects SET visibility='restricted' WHERE id=$1",[deletable]);
 await c.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level) VALUES('project',$1,$2,'view')",[deletable,reader]);
 await c.query("INSERT INTO project_tasks(id,project_id,title) VALUES($1,$2,'Draft child rollback fixture')",[childTask,deletable]);
 await c.query("INSERT INTO items(id,name,type,status,current_quantity,initial_quantity) VALUES($1,'Audit rollback stock','component','available',10,10)",[item]);
 await c.query("INSERT INTO project_reservations(id,project_id,item_id,requested_by,quantity,original_quantity,needed_from,status) VALUES($1,$2,$3,$4,2,2,now(),'pending_review')",[reservation,project,item,actor]);
 pool.query=(...args)=>c.query(...args);
 pool.connect=async()=>({async query(sql,args){
  if(sql==='BEGIN'){assert.equal(routeActive,false);await c.query('SAVEPOINT project_audit_route');routeActive=true;return;}
  if(sql==='COMMIT'){await c.query('RELEASE SAVEPOINT project_audit_route');routeActive=false;return;}
  if(sql==='ROLLBACK'){if(routeActive){await c.query('ROLLBACK TO SAVEPOINT project_audit_route');await c.query('RELEASE SAVEPOINT project_audit_route');routeActive=false;}return;}
  if(failAudit&&sql.includes('INSERT INTO audit_log')||failReceipt&&sql.startsWith('INSERT INTO sync_idempotency'))return c.query('SELECT 1/0');
  return c.query(sql,args);
 },release(){assert.equal(routeActive,false);}});
 const app=express();app.use(express.json());app.use('/api/projects',authenticateToken,projectsRouter);app.use('/api/sync',authenticateToken,syncRouter);
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:{code:error.code||'PROBE_ERROR'}}));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const version=(await c.query('SELECT credential_version FROM users WHERE id=$1',[actor])).rows[0].credential_version;
 const token=jwt.sign({userId:actor,credentialVersion:version},config.jwtSecret,{expiresIn:'5m'});
 async function request(method,path,body,status){
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const data=response.status===204?null:await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
 }
 failAudit=true;await request('PUT',`${project}/visibility`,{visibility:'restricted'},500);failAudit=false;
 assert.equal((await c.query('SELECT visibility FROM projects WHERE id=$1',[project])).rows[0].visibility,'lab');
 assert.equal((await c.query("SELECT 1 FROM record_access_grants WHERE entity_type='project' AND entity_id=$1",[project])).rowCount,0);
 await request('PUT',`${project}/visibility`,{visibility:'restricted'},200);
 assert.equal((await c.query("SELECT 1 FROM record_access_grants WHERE entity_type='project' AND entity_id=$1 AND user_id=$2",[project,actor])).rowCount,1);
 const decisionPath=`${project}/reservations/${reservation}/decision`;
 failAudit=true;await request('POST',decisionPath,{decision:'confirm'},500);failAudit=false;
 assert.equal((await c.query('SELECT status FROM project_reservations WHERE id=$1',[reservation])).rows[0].status,'pending_review');
 await request('POST',decisionPath,{decision:'confirm'},200);
 const fulfillPath=`${project}/reservations/${reservation}/fulfill`,fulfillment={request_id:randomUUID(),quantity:1};
 failAudit=true;await request('POST',fulfillPath,fulfillment,500);failAudit=false;
 assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),10);
 assert.equal(Number((await c.query('SELECT quantity FROM project_reservations WHERE id=$1',[reservation])).rows[0].quantity),2);
 assert.equal((await c.query('SELECT 1 FROM project_reservation_fulfillments WHERE reservation_id=$1',[reservation])).rowCount,0);
 assert.equal((await c.query('SELECT 1 FROM item_movements WHERE project_id=$1',[project])).rowCount,0);
 await request('POST',fulfillPath,fulfillment,200);
 const audits=(await c.query('SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id=$1',[actor])).rows[0].n;
 assert.equal((await request('POST',fulfillPath,fulfillment,200)).already_fulfilled,true);
 assert.equal((await c.query('SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id=$1',[actor])).rows[0].n,audits);
 assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),9);
 failAudit=true;await request('DELETE',deletable,null,500);failAudit=false;
 assert.equal((await c.query('SELECT 1 FROM projects WHERE id=$1',[deletable])).rowCount,1);
 assert.equal((await c.query('SELECT 1 FROM project_tasks WHERE id=$1',[childTask])).rowCount,1);
 assert.equal((await c.query("SELECT 1 FROM sync_tombstones WHERE entity_type='project_task' AND entity_id=$1",[childTask])).rowCount,0);
 assert.equal((await c.query("SELECT 1 FROM sync_tombstones WHERE entity_type='project' AND entity_id=$1",[deletable])).rowCount,0);
 assert.equal((await c.query('SELECT 1 FROM sync_deleted_project_audience WHERE project_id=$1',[deletable])).rowCount,0);
 await request('DELETE',deletable,null,204);
 assert.equal((await c.query('SELECT 1 FROM projects WHERE id=$1',[deletable])).rowCount,0);
 assert.equal((await c.query('SELECT 1 FROM project_tasks WHERE id=$1',[childTask])).rowCount,0);
 assert.equal((await c.query("SELECT 1 FROM sync_tombstones WHERE entity_type='project_task' AND entity_id=$1",[childTask])).rowCount,1);
 assert.equal((await c.query("SELECT 1 FROM sync_tombstones WHERE entity_type='project' AND entity_id=$1",[deletable])).rowCount,1);
 assert.equal((await c.query("SELECT 1 FROM audit_log WHERE entity_type='project' AND entity_id=$1 AND action='DELETE'",[deletable])).rowCount,1);
 assert.equal((await c.query("SELECT 1 FROM record_access_grants WHERE entity_type='project' AND entity_id=$1",[deletable])).rowCount,0);
 for(const [userId,allowed] of [[reader,true],[outsider,false]]){
  const credentialVersion=(await c.query('SELECT credential_version FROM users WHERE id=$1',[userId])).rows[0].credential_version;
  const bearer=jwt.sign({userId,credentialVersion},config.jwtSecret,{expiresIn:'5m'});
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/sync/projects/pull`,{headers:{Authorization:`Bearer ${bearer}`},signal:AbortSignal.timeout(20000)});
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
  assert.equal(body.deleted_project_ids.includes(deletable),allowed);
  assert.equal(body.deleted_project_entities.project_task.includes(childTask),allowed);
 }
 console.log('PASS: deleted private project and child tombstones survive and are delivered to former readers, not outsiders.');
 const nativeProject=randomUUID(),nativeChild=randomUUID(),survivingNote=randomUUID(),resource=randomUUID();
 await c.query("INSERT INTO projects(id,name,owner_id) VALUES($1,'Outbox deletion rollback fixture',$2)",[nativeProject,actor]);
 await c.query("INSERT INTO project_tasks(id,project_id,title) VALUES($1,$2,'Outbox child')",[nativeChild,nativeProject]);
 await c.query("INSERT INTO notes(id,title,project_id,author_id) VALUES($1,'Surviving note',$2,$3)",[survivingNote,nativeProject,actor]);
 await c.query("INSERT INTO resources(id,name,kind,file_type,project_id) VALUES($1,'Deleted resource','file','other',$2)",[resource,nativeProject]);
 await c.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level) VALUES('note',$1,$3,'view'),('resource',$2,$3,'view')",[survivingNote,resource,reader]);
 const device=randomUUID(),change={change_id:randomUUID(),entity_type:'project',entity_id:nativeProject,operation:'delete',payload:{project:{id:nativeProject}}};
 async function pushDelete(){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/sync/push`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({device_id:device,changes:[change]}),signal:AbortSignal.timeout(20000)});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.results[0];}
 for(const failure of ['audit','receipt']){
  failAudit=failure==='audit';failReceipt=failure==='receipt';assert.equal((await pushDelete()).status,'failed');failAudit=false;failReceipt=false;
  assert.equal((await c.query('SELECT 1 FROM projects WHERE id=$1',[nativeProject])).rowCount,1);
  assert.equal((await c.query('SELECT 1 FROM sync_deleted_project_audience WHERE project_id=$1',[nativeProject])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM sync_tombstones WHERE project_id=$1',[nativeProject])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[change.change_id])).rowCount,0);
 }
 const first=await pushDelete();assert.equal(first.status,'synced');assert.deepEqual(await pushDelete(),first);
 assert.equal((await c.query('SELECT 1 FROM projects WHERE id=$1',[nativeProject])).rowCount,0);
 assert.equal((await c.query('SELECT project_id FROM notes WHERE id=$1',[survivingNote])).rows[0].project_id,null);
 assert.equal((await c.query("SELECT 1 FROM record_access_grants WHERE entity_type='note' AND entity_id=$1",[survivingNote])).rowCount,1);
 assert.equal((await c.query("SELECT 1 FROM record_access_grants WHERE entity_type='resource' AND entity_id=$1",[resource])).rowCount,0);
 assert.equal((await c.query('SELECT 1 FROM sync_tombstones WHERE project_id=$1 AND entity_id=ANY($2::uuid[])',[nativeProject,[nativeProject,nativeChild,resource]])).rowCount,3);
 assert.equal((await c.query("SELECT 1 FROM audit_log WHERE entity_id=$1 AND action='sync:delete'",[nativeProject])).rowCount,1);
 console.log('PASS: native project outbox deletion uses shared child/resource evidence, preserves surviving-note grants, and rolls back on SQL audit/receipt failure; replay creates one audit.');

 console.log('PASS: required audit failure rolls back visibility/grants, reservation decisions, stock fulfillment and project/tombstone deletion; fulfillment replay has one stock effect and audit.');
}finally{
 if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 pool.query=originalQuery;pool.connect=originalConnect;
 try{
  await c.query('ROLLBACK');
  assert.equal((await c.query('SELECT 1 FROM users WHERE id=$1',[actor])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM projects WHERE id=ANY($1::uuid[])',[[project,deletable]])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM items WHERE id=$1',[item])).rowCount,0);
  console.log('PASS: real PostgreSQL fixtures absent after rollback.');
 }finally{c.release();await pool.end();}
}
