// Production read route, real development PostgreSQL, rollback-only fixtures.
import assert from 'node:assert/strict';
import express from 'express';
import jwt from 'jsonwebtoken';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {config} from './config.js';
import {authenticateToken} from './middleware/auth.js';
import projectsRouter from './routes/projects.js';
if(process.env.LABOS_DEV_REVIEW_PROBE!=='rollback-only')throw Error('Explicit rollback-only development opt-in required');
const c=await pool.connect(),originalQuery=pool.query;
const user=randomUUID(),projects=[randomUUID(),randomUUID()],items=[randomUUID(),randomUUID()];
const reservations=Array.from({length:6},()=>randomUUID());
let server;
try{
 await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='15s'");
 await c.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,$3,'admin',true)",[user,`review-probe-${user}`,randomUUID()]);
 await c.query("INSERT INTO projects(id,name,owner_id) VALUES($1,'Review fixture A',$3),($2,'Review fixture B',$3)",[...projects,user]);
 await c.query("INSERT INTO items(id,name,type,current_quantity) VALUES($1,'Review meter','equipment',10),($2,'Review components','component',10)",items);
 for(let i=0;i<6;i++){
  const slot=i%3,pending=slot===0;
  await c.query("INSERT INTO project_reservations(id,project_id,item_id,requested_by,quantity,original_quantity,needed_from,needed_until,status) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8)",[
   reservations[i],projects[pending?0:1],items[i<3?0:1],user,pending?2:slot===1?3:4,
   slot===2?'2026-10-29T11:00:00Z':'2026-10-29T10:00:00Z',slot===2?'2026-10-29T12:00:00Z':'2026-10-29T11:00:00Z',pending?'pending_review':'confirmed']);
 }
 pool.query=(...args)=>c.query(...args);
 const app=express();app.use('/api/projects',authenticateToken,projectsRouter);
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const version=(await c.query('SELECT credential_version FROM users WHERE id=$1',[user])).rows[0].credential_version;
 const token=jwt.sign({userId:user,credentialVersion:version},config.jwtSecret,{expiresIn:'5m'});
 const response=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/reservations/review-queue`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200);const rows=await response.json();
 const equipment=rows.find(r=>r.id===reservations[0]),components=rows.find(r=>r.id===reservations[3]);
 assert.ok(equipment);assert.ok(components);
 assert.equal(Number(equipment.overlapping_confirmed),3);
 assert.equal(Number(components.overlapping_confirmed),7);
 assert.equal(Number(equipment.current_quantity),10);
 assert.ok(reservations.filter((_,i)=>i%3!==0).every(id=>!rows.some(r=>r.id===id)));
 assert.equal((await c.query('SELECT current_quantity FROM items WHERE id=$1',[items[0]])).rows[0].current_quantity,'10.000');
 console.log('PASS: authenticated production queue preserves stock, excludes confirmed rows, counts reusable overlap and all consumable commitments across projects.');
}finally{
 if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 pool.query=originalQuery;
 try{
  await c.query('ROLLBACK');
  for(const [table,ids] of [['users',[user]],['projects',projects],['items',items],['project_reservations',reservations]])
   assert.equal((await c.query(`SELECT 1 FROM ${table} WHERE id=ANY($1::uuid[])`,[ids])).rowCount,0,`${table} fixtures survived rollback`);
  console.log('PASS: all fixtures absent after rollback.');
 }finally{c.release();await pool.end();}
}
