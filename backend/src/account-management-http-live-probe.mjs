import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
import auth from './routes/auth.js';
if(process.env.LABOS_DEV_ACCOUNT_MANAGEMENT_PROBE!=='rollback-only')throw Error('Explicit rollback-only opt-in required');
const c=await pool.connect(),originalQuery=pool.query,originalConnect=pool.connect;
const actor=randomUUID(),target=randomUUID(),username=`admin-create-probe-${randomUUID()}`;
let server,active=false,change=null,failAudit=false;
try{
 await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='10s'");
 for(const [id,role] of [[actor,'admin'],[target,'member']])await c.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'test-no-login',$3,true)",[id,`admin-write-${id}`,role]);
 pool.query=(...args)=>c.query(...args);
 pool.connect=async()=>({async query(sql,args){
  if(sql==='BEGIN'){
   assert.equal(active,false);await c.query('SAVEPOINT account_management_route');active=true;
   if(change==='disable')await c.query('UPDATE users SET is_active=false WHERE id=$1',[actor]);
   if(change==='demote')await c.query("UPDATE users SET role='viewer' WHERE id=$1",[actor]);
   if(change==='credentials')await c.query('UPDATE users SET credential_version=credential_version+1 WHERE id=$1',[actor]);
   return;
  }
  if(sql==='COMMIT'){await c.query('RELEASE SAVEPOINT account_management_route');active=false;return;}
  if(sql==='ROLLBACK'){if(active){await c.query('ROLLBACK TO SAVEPOINT account_management_route');await c.query('RELEASE SAVEPOINT account_management_route');active=false;}return;}
  if(failAudit&&sql.includes('INSERT INTO audit_log'))return c.query('SELECT 1/0');return c.query(sql,args);
 },release(){assert.equal(active,false);}});
 const app=express();app.use(express.json());app.use('/auth',auth);app.use((error,req,res,next)=>res.status(error.status||500).json({error:{code:error.code||'PROBE_ERROR'}}));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const version=(await c.query('SELECT credential_version FROM users WHERE id=$1',[actor])).rows[0].credential_version;
 const token=jwt.sign({userId:actor,credentialVersion:version},config.jwtSecret,{expiresIn:'5m'});
 const operations=[['POST','users',{username,password:'Probe-Only-Password-2026',role:'member'},201],['PATCH',`users/${target.toUpperCase()}`,{role:'researcher'},200],['POST',`users/${target}/password`,{new_password:'Probe-Only-Replacement-2026'},200],['PUT',`users/${target}/permissions`,{overrides:[{permission:'finance.edit',effect:'grant'}]},200]];
 async function request([method,path,body],statuses){const response=await fetch(`http://127.0.0.1:${server.address().port}/auth/${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});const value=await response.json();assert.ok(statuses.includes(response.status),`Unexpected ${response.status}: ${JSON.stringify(value)}`);return value;}
 for(const operation of operations)for(const kind of ['disable','demote','credentials']){
  change=kind;await request(operation,kind==='disable'?[403]:kind==='credentials'?[401]:[401,403]);change=null;
  assert.equal((await c.query('SELECT 1 FROM users WHERE username=$1',[username])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM user_permission_overrides WHERE user_id=$1',[target])).rowCount,0);
  const stored=(await c.query('SELECT role,password_hash FROM users WHERE id=$1',[target])).rows[0];assert.equal(stored.role,'member');assert.equal(stored.password_hash,'test-no-login');
 }
 for(const operation of operations){failAudit=true;await request(operation,[500]);failAudit=false;}
 assert.equal((await c.query('SELECT 1 FROM users WHERE username=$1',[username])).rowCount,0);
 assert.equal((await c.query('SELECT role FROM users WHERE id=$1',[target])).rows[0].role,'member');
 assert.equal((await c.query('SELECT password_hash FROM users WHERE id=$1',[target])).rows[0].password_hash,'test-no-login');
 for(const operation of operations)await request(operation,[operation[3]]);
 assert.equal((await c.query('SELECT 1 FROM users WHERE username=$1',[username])).rowCount,1);
 assert.equal((await c.query('SELECT role FROM users WHERE id=$1',[target])).rows[0].role,'researcher');
 assert.notEqual((await c.query('SELECT password_hash FROM users WHERE id=$1',[target])).rows[0].password_hash,'test-no-login');
 assert.equal((await c.query("SELECT 1 FROM user_permission_overrides WHERE user_id=$1 AND permission='finance.edit' AND effect='grant'",[target])).rowCount,1);
 assert.equal((await c.query("SELECT 1 FROM audit_log WHERE actor_user_id=$1 AND entity_type IN ('user','user_password','user_permissions')",[actor])).rowCount,4);
 await request(['PATCH',`users/${actor.toUpperCase()}`,{is_active:false}],[400]);
 assert.equal((await c.query('SELECT is_active FROM users WHERE id=$1',[actor])).rows[0].is_active,true);
 console.log('PASS: actual PostgreSQL production account create/role/password/permission routes reject mid-request disable/demotion/credential revocation, normalize target UUIDs, and roll every effect back on required audit failure.');
}finally{
 if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});pool.query=originalQuery;pool.connect=originalConnect;
 try{await c.query('ROLLBACK');assert.equal((await c.query('SELECT 1 FROM users WHERE id=ANY($1::uuid[]) OR username=$2',[[actor,target],username])).rowCount,0);console.log('PASS: administrative fixtures/effects rolled back.');}finally{c.release();await pool.end();}
}
