// Real development PostgreSQL + production auth/routes. All fixture effects roll back.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
import {authenticateToken} from './middleware/auth.js';
import {projectWorkspaceBoundary} from './middleware/project-workspace-boundary.js';
import projectsRouter from './routes/projects.js';
import workspaceRouter from './routes/project-workspace.js';

if(process.env.LABOS_DEV_PROJECT_ACCESS_PROBE!=='rollback-only')throw Error('Explicit development rollback-only opt-in required');
const c=await pool.connect(),originalQuery=pool.query,originalConnect=pool.connect;
const actor=randomUUID(),target=randomUUID(),lead=randomUUID(),project=randomUUID(),keys=[];
let server,active=false,failAt=null,authorityChange=null;
try{
 await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='10s'");
 for(const [id,role] of [[actor,'admin'],[target,'researcher'],[lead,'researcher']])await c.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'no-login',$3,true)",[id,`access-probe-${id}`,role]);
 await c.query("INSERT INTO projects(id,name,owner_id,visibility) VALUES($1,'Rollback project access',$2,'restricted')",[project,actor]);
 await c.query("INSERT INTO project_members(project_id,user_id,member_role) VALUES($1,$2,'lead')",[project,lead]);
 await c.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,'projects.edit','grant')",[lead]);
 pool.query=(...args)=>c.query(...args);
 pool.connect=async()=>({async query(sql,args){
  if(sql==='BEGIN'){
   assert.equal(active,false);await c.query('SAVEPOINT access_route');active=true;
   if(authorityChange==='demote')await c.query("UPDATE users SET role='viewer' WHERE id=$1",[actor]);
   if(authorityChange==='disable')await c.query('UPDATE users SET is_active=false WHERE id=$1',[actor]);
   if(authorityChange==='deny'){await c.query("UPDATE users SET role='researcher' WHERE id=$1",[actor]);await c.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,'projects.edit','deny')",[actor]);}
   if(authorityChange==='target-disable')await c.query('UPDATE users SET is_active=false WHERE id=$1',[target]);
   return;
  }
  if(sql==='COMMIT'){await c.query('RELEASE SAVEPOINT access_route');active=false;return;}
  if(sql==='ROLLBACK'){if(active){await c.query('ROLLBACK TO SAVEPOINT access_route');await c.query('RELEASE SAVEPOINT access_route');active=false;}return;}
  if(failAt==='audit'&&sql.includes('INSERT INTO audit_log')||failAt==='receipt'&&sql.startsWith('INSERT INTO sync_idempotency'))return c.query('SELECT 1/0');
  return c.query(sql,args);
 },release(){assert.equal(active,false);}});
 const app=express();app.use(express.json());app.use('/api/projects',authenticateToken,projectWorkspaceBoundary,workspaceRouter,projectsRouter);
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:{code:error.code||'PROBE_ERROR'}}));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 async function tokenFor(userId){const version=(await c.query('SELECT credential_version FROM users WHERE id=$1',[userId])).rows[0].credential_version;return jwt.sign({userId,credentialVersion:version},config.jwtSecret,{expiresIn:'5m'});}
 const token=await tokenFor(actor),leadToken=await tokenFor(lead);
 async function request(method,path,body,status,key=randomUUID(),bearer=token){
  keys.push(key);
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${project}/${path}`,{method,headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json','Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const result=response.status===204?null:await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;
 }
 const members='members',member=`members/${target}`,grant=`access-grants/${target}`;
 const addBody={user_id:target,member_role:'member',expected_value:null},addKey=randomUUID();
 for(const failure of ['audit','receipt']){
  failAt=failure;await request('POST',members,addBody,500,addKey);failAt=null;
  assert.equal((await c.query('SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2',[project,target])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[addKey])).rowCount,0);
  assert.equal((await c.query("SELECT 1 FROM audit_log WHERE entity_type='project_member' AND entity_id=$1",[target])).rowCount,0);
 }
 await request('POST',members,addBody,201,addKey);await request('POST',members,addBody,201,addKey);
 assert.equal((await c.query("SELECT 1 FROM audit_log WHERE entity_type='project_member' AND entity_id=$1",[target])).rowCount,1);
 await request('POST',members,{...addBody,member_role:'lead'},409);
 await request('POST',members,{...addBody,member_role:'lead',expected_value:'member'},201);
 await request('POST',members,addBody,201,addKey);
 assert.equal((await c.query('SELECT member_role FROM project_members WHERE project_id=$1 AND user_id=$2',[project,target])).rows[0].member_role,'lead');
 await request('DELETE',member,{expected_value:'member'},409);
 const removeKey=randomUUID();await request('DELETE',member,{expected_value:'lead'},204,removeKey);await request('DELETE',member,{expected_value:'lead'},204,removeKey);
 await request('POST',members,{...addBody,member_role:'observer'},201);
 await request('DELETE',member,{expected_value:'lead'},204,removeKey);
 assert.equal((await c.query('SELECT member_role FROM project_members WHERE project_id=$1 AND user_id=$2',[project,target])).rows[0].member_role,'observer');
 const grantKey=randomUUID(),grantBody={access_level:'view',expected_value:null};
 for(const failure of ['audit','receipt']){
  failAt=failure;await request('PUT',grant,grantBody,500,grantKey);failAt=null;
  assert.equal((await c.query("SELECT 1 FROM record_access_grants WHERE entity_type='project' AND entity_id=$1 AND user_id=$2",[project,target])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[grantKey])).rowCount,0);
 }
 await request('PUT',grant,grantBody,200,grantKey);await request('PUT',grant,grantBody,200,grantKey);
 await request('PUT',grant,{...grantBody,access_level:'edit'},409,grantKey);
 await request('PUT',grant,{access_level:'edit',expected_value:'view'},200);
 await request('PUT',grant,grantBody,200,grantKey);
 assert.equal((await c.query("SELECT access_level FROM record_access_grants WHERE entity_type='project' AND entity_id=$1 AND user_id=$2",[project,target])).rows[0].access_level,'edit');
 const revokeKey=randomUUID();await request('DELETE',grant,{expected_value:'view'},409);
 await request('DELETE',grant,{expected_value:'edit'},204,revokeKey);await request('PUT',grant,grantBody,200);
 await request('DELETE',grant,{expected_value:'edit'},204,revokeKey);
 assert.equal((await c.query("SELECT access_level FROM record_access_grants WHERE entity_type='project' AND entity_id=$1 AND user_id=$2",[project,target])).rows[0].access_level,'view');
 for(const change of ['demote','disable','deny']){
  authorityChange=change;await request('POST',members,{...addBody,member_role:'lead',expected_value:'observer'},403);authorityChange=null;
  assert.equal((await c.query('SELECT role FROM users WHERE id=$1',[actor])).rows[0].role,'admin');
 }
 authorityChange='target-disable';await request('PUT',grant,{access_level:'edit',expected_value:'view'},400);authorityChange=null;
 await request('PUT',grant,{access_level:'edit',expected_value:'view'},200,randomUUID(),leadToken);
 await c.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',[project,lead]);
 await request('PUT',grant,{access_level:'view',expected_value:'edit'},403,randomUUID(),leadToken);
 await request('GET','access-grants',null,200);
 console.log('PASS: current transactional authority, stale-base rejection, stable receipts, replay without restoring/deleting newer access, and real SQL audit/receipt rollback.');
}finally{
 if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 pool.query=originalQuery;pool.connect=originalConnect;
 try{
  await c.query('ROLLBACK');
  assert.equal((await c.query('SELECT 1 FROM users WHERE id=ANY($1::uuid[])',[[actor,target,lead]])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM projects WHERE id=$1',[project])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=ANY($1::text[])',[keys])).rowCount,0);
  console.log('PASS: all project access fixtures absent after rollback.');
 }finally{c.release();await pool.end();}
}
