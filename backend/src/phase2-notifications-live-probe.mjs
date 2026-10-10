import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
if(process.env.LABOS_PHASE2_NOTIFICATIONS_PROBE!=='1')throw Error('Explicit notification test opt-in required');
const users=[randomUUID(),randomUUID()],ids=Array.from({length:4},randomUUID),project=randomUUID(),keys=[],marker='LABOS-P2-NOTIFICATIONS-'+randomUUID();
async function http(method,path,body,user=users[0],key){const r=await fetch('http://127.0.0.1:4000/api'+path,{method,headers:{Authorization:'Bearer '+jwt.sign({userId:user},config.jwtSecret,{expiresIn:'10m'}),'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json().catch(()=>null)};}
const key=()=>{const k=randomUUID();keys.push(k);return k;};
async function notify(id,user=users[0],entity=null){await pool.query("INSERT INTO notifications(id,user_id,type,title,entity_type,entity_id) VALUES($1,$2,'test',$3,$4,$5)",[id,user,marker,entity?'project':null,entity]);}
async function push(change,user=users[0]){const r=await http('POST','/sync/push',{device_id:'notification-probe',changes:[change]},user);assert.equal(r.status,200,JSON.stringify(r));return r.body.results[0];}
try{
  for(const[i,user]of users.entries())await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-login','viewer')",[user,marker+i]);
  await notify(ids[0]);await notify(ids[2],users[1]);
  const change={change_id:key(),entity_type:'notification_read',entity_id:users[0],operation:'update',payload:{ids:[ids[0]]}};
  for(const r of await Promise.all([push(change),push(change)]))assert.equal(r.status,'synced',JSON.stringify(r));
  const first=(await pool.query('SELECT read_at FROM notifications WHERE id=$1',[ids[0]])).rows[0].read_at;assert.ok(first);
  await notify(ids[1]);await push(change);
  assert.equal((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[ids[1]])).rows[0].read_at,null,'Later arrival must not be marked by replay');
  assert.equal((await push({...change,change_id:key(),payload:{ids:[ids[2]]}})).error.code,'NOTIFICATION_ACCOUNT_MISMATCH');
  assert.equal((await push({...change,change_id:key()},users[1])).error.code,'NOTIFICATION_ACCOUNT_MISMATCH');
  assert.equal((await push({...change,change_id:key(),payload:{ids:[]}})).status,'rejected');
  const httpKey=key();const body={ids:[ids[1]]};
  const a=await http('POST','/collaboration/notifications/read-all',body,users[0],httpKey);
  assert.equal(a.status,200,JSON.stringify(a));assert.deepEqual(await http('POST','/collaboration/notifications/read-all',body,users[0],httpKey),a);
  assert.equal((await http('POST','/experience/notifications/read-all',{ids:[ids[0]]},users[0],httpKey)).status,409,'Aliases cannot reuse key with another payload');
  assert.equal((await http('POST',`/experience/notifications/${ids[0]}/read`,{},users[0],key())).status,200);
  assert.deepEqual((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[ids[0]])).rows[0].read_at,first,'Read timestamp is monotonic, not refreshed');
  await pool.query("INSERT INTO projects(id,name,visibility,owner_id) VALUES($1,$2,'restricted',$3)",[project,marker,users[1]]);
  await notify(ids[3],users[0],project);
  let pull=await http('GET','/sync/notifications/pull');assert.equal(pull.body.snapshot_complete,true);assert.equal(pull.body.records.some(r=>r.id===ids[3]),false);
  assert.equal((await push({...change,change_id:key(),payload:{ids:[ids[3]]}})).status,'synced');
  assert.equal((await pool.query('SELECT read_at FROM notifications WHERE id=$1',[ids[3]])).rows[0].read_at,null,'Hidden referenced records are not acknowledged');
  await pool.query('DELETE FROM notifications WHERE id=$1',[ids[0]]);assert.equal((await push({...change,change_id:key()})).status,'synced','Deleted notification acknowledgement converges');
  await pool.query('UPDATE users SET is_active=false WHERE id=$1',[users[0]]);assert.equal((await http('GET','/sync/notifications/pull')).status,401);
  console.log('PASS PostgreSQL notifications: parallel replay, frozen read-all, own-account enforcement, strict input, alias HTTP retries, stable read timestamp, hidden-content filtering, deleted-ID convergence and disabled account.');
}finally{
  await pool.query('DELETE FROM sync_idempotency WHERE change_id=ANY($1::text[])',[keys]);
  await pool.query('DELETE FROM notifications WHERE user_id=ANY($1::uuid[])',[users]);
  await pool.query('DELETE FROM projects WHERE id=$1',[project]);
  await pool.query('DELETE FROM sync_tombstones WHERE entity_id=$1',[project]);
  await pool.query('DELETE FROM audit_log WHERE actor_user_id=ANY($1::uuid[])',[users]);
  await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await pool.end();
}
