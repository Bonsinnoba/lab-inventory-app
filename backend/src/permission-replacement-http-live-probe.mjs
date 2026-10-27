// Real loopback HTTP + production auth/router, real development PostgreSQL.
// Pool is scoped to one outer rollback transaction; route commits use savepoints.
// Revocation hook deterministically models the gap after middleware, not a
// simultaneous independent-session commit. Separate lock probe covers locking.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
import router from './routes/auth.js';
if(process.env.LABOS_DEV_REVIEW_PROBE!=='1')throw Error('Development opt-in required');
const c=await pool.connect(),originalQuery=pool.query,originalConnect=pool.connect;
let hook=null,failAudit=false,inRoute=false,server;
const actor=randomUUID(),target=randomUUID();
const routeClient={async query(sql,args){
  if(sql==='BEGIN'){await c.query('SAVEPOINT route_write');inRoute=true;return;}
  if(sql==='COMMIT'){await c.query('RELEASE SAVEPOINT route_write');inRoute=false;return;}
  if(sql==='ROLLBACK'){if(inRoute){await c.query('ROLLBACK TO SAVEPOINT route_write');await c.query('RELEASE SAVEPOINT route_write');inRoute=false;}return;}
  if(failAudit&&sql.includes('INSERT INTO audit_log'))throw Error('Expected probe audit failure');
  return c.query(sql,args);
},release(){assert.equal(inRoute,false);}};
const checkState=async()=>({
  overrides:(await c.query('SELECT permission,effect FROM user_permission_overrides WHERE user_id=$1 ORDER BY permission',[target])).rows,
  audits:(await c.query('SELECT id FROM audit_log WHERE entity_id=$1 ORDER BY id',[target])).rows,
});
try{
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='10s'");
  await c.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'no-login','admin',true),($3,$4,'no-login','member',true)",[actor,'probe-'+actor,target,'probe-'+target]);
  const user=(await c.query('SELECT credential_version FROM users WHERE id=$1',[actor])).rows[0];
  const token=jwt.sign({userId:actor,credentialVersion:user.credential_version},config.jwtSecret,{expiresIn:'5m'});
  pool.query=(...args)=>c.query(...args);
  pool.connect=async()=>{if(hook){const run=hook;hook=null;await run();}return routeClient;};
  const app=express();app.use(express.json());app.use('/api/auth',router);
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const url=`http://127.0.0.1:${server.address().port}/api/auth/users/${target}/permissions`;
  const send=async(body,auth=true)=>{const r=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  async function scenario(name,fn){
    await c.query('SAVEPOINT scenario');
    try{await fn();console.log(`PASS ${name}`);}
    finally{hook=null;failAudit=false;await c.query('ROLLBACK TO SAVEPOINT scenario');await c.query('RELEASE SAVEPOINT scenario');}
  }
  await scenario('authenticated replacement persists overrides and mandatory audit',async()=>{
    const r=await send({overrides:[{permission:'projects.edit',effect:'grant'}]});
    assert.equal(r.status,200,JSON.stringify(r.body));
    const state=await checkState();assert.deepEqual(state.overrides,[{permission:'projects.edit',effect:'grant'}]);assert.equal(state.audits.length,1);
  });
  await scenario('unauthenticated HTTP request cannot write',async()=>{
    const before=await checkState();assert.equal((await send({overrides:[]},false)).status,401);assert.deepEqual(await checkState(),before);
  });
  for(const [name,sql,code] of [
    ['actor disabled after middleware',"UPDATE users SET is_active=false WHERE id=$1",'ACCOUNT_DISABLED'],
    ['actor demoted after middleware',"UPDATE users SET role='member' WHERE id=$1",'PERMISSION_DENIED'],
  ])await scenario(name,async()=>{
    const before=await checkState();hook=()=>c.query(sql,[actor]);
    const r=await send({overrides:[]});assert.equal(r.status,403);assert.equal(r.body.error.code,code);assert.deepEqual(await checkState(),before);
  });
  await scenario('delegated permission revoked after middleware',async()=>{
    await c.query("UPDATE users SET role='member' WHERE id=$1",[actor]);
    await c.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,'users.manage_permissions','grant')",[actor]);
    const before=await checkState();hook=()=>c.query('DELETE FROM user_permission_overrides WHERE user_id=$1',[actor]);
    const r=await send({overrides:[]});assert.equal(r.status,403);assert.equal(r.body.error.code,'PERMISSION_DENIED');assert.deepEqual(await checkState(),before);
  });
  await scenario('removing an unheld deny through HTTP is rejected',async()=>{
    await c.query("UPDATE users SET role='member' WHERE id=$1",[actor]);
    await c.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,'users.manage_permissions','grant'),($2,'finance.view_sensitive','deny')",[actor,target]);
    const before=await checkState(),r=await send({overrides:[]});assert.equal(r.status,403);assert.equal(r.body.error.code,'PERMISSION_ESCALATION_BLOCKED');assert.deepEqual(await checkState(),before);
  });
  await scenario('audit failure rolls back replacement',async()=>{
    const before=await checkState();failAudit=true;
    assert.equal((await send({overrides:[{permission:'projects.edit',effect:'grant'}]})).status,500);assert.deepEqual(await checkState(),before);
  });
  await scenario('malformed input cannot implicitly clear permissions',async()=>{
    await c.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,'projects.edit','grant')",[target]);
    const before=await checkState();
    for(const body of [{},{overrides:null},{overrides:{}},{overrides:'clear'}]){
      const r=await send(body);assert.equal(r.status,400);assert.equal(r.body.error.code,'INVALID_PERMISSION_OVERRIDES');assert.deepEqual(await checkState(),before);
    }
    assert.equal((await send({overrides:[]})).status,200);
    assert.deepEqual((await checkState()).overrides,[]);
  });
  console.log('PASS 8 real HTTP scenarios; outer fixture transaction rolled back. No deployment or V1 changes.');
}finally{
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  pool.query=originalQuery;pool.connect=originalConnect;
  await c.query('ROLLBACK');c.release();await pool.end();
}
