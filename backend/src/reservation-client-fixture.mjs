// Disposable, uniquely named fixture for the native/HTTP reconciliation test.
import {pool} from './db.js';
import {config} from './config.js';
import jwt from 'jsonwebtoken';
import {randomUUID} from 'node:crypto';
const id=process.env.LABOS_RESERVATION_FIXTURE_ID,action=process.env.LABOS_RESERVATION_FIXTURE_ACTION;
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id||''))throw Error('Unique fixture UUID required');
const name=`LABOS-RESERVATION-PROBE-${id}`,c=await pool.connect();
try{
 await c.query('BEGIN');let result={ok:true};
 if(action==='create'){
  const item=randomUUID(),project=randomUUID(),reservation=randomUUID();
  await c.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-login','admin')",[id,name]);
  await c.query("INSERT INTO items(id,name,type,initial_quantity,current_quantity) VALUES($1,$2,'component',10,10)",[item,name]);
  await c.query("INSERT INTO projects(id,name,status,owner_id) VALUES($1,$2,'planning',$3)",[project,name,id]);
  await c.query("INSERT INTO project_reservations(id,project_id,item_id,requested_by,quantity,original_quantity,needed_from,status) VALUES($1,$2,$3,$4,6,6,now(),'confirmed')",[reservation,project,item,id]);
  result={item,project,reservation,token:jwt.sign({userId:id},config.jwtSecret,{expiresIn:'15m'})};
 }else if(action==='cleanup'){
  if(!(await c.query('SELECT id FROM users WHERE id=$1 AND username=$2 FOR UPDATE',[id,name])).rowCount)throw Error('Fixture owner mismatch');
  const items=(await c.query('SELECT id FROM items WHERE name=$1',[name])).rows.map(r=>r.id);
  const projects=(await c.query('SELECT id FROM projects WHERE name=$1 AND owner_id=$2',[name,id])).rows.map(r=>r.id);
  await c.query('DELETE FROM project_reservation_fulfillments WHERE reservation_id IN (SELECT id FROM project_reservations WHERE project_id=ANY($1::uuid[]) AND requested_by=$2)',[projects,id]);
  await c.query('DELETE FROM project_reservations WHERE project_id=ANY($1::uuid[]) AND requested_by=$2',[projects,id]);
  await c.query('DELETE FROM item_movements WHERE item_id=ANY($1::uuid[]) AND performed_by=$2',[items,id]);
  await c.query('DELETE FROM projects WHERE id=ANY($1::uuid[]) AND owner_id=$2 AND name=$3',[projects,id,name]);
  await c.query('DELETE FROM items WHERE id=ANY($1::uuid[]) AND name=$2',[items,name]);
  await c.query('DELETE FROM sync_idempotency WHERE user_id=$1',[id]);
  await c.query('DELETE FROM audit_log WHERE actor_user_id=$1',[id]);
  await c.query('DELETE FROM notifications WHERE user_id=$1',[id]);
  await c.query('DELETE FROM users WHERE id=$1 AND username=$2',[id,name]);
 }else throw Error('Unknown fixture action');
 await c.query('COMMIT');console.log(JSON.stringify(result));
}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}
