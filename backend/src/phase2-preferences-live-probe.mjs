import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
if(process.env.LABOS_PHASE2_PREFERENCES_PROBE!=='1')throw new Error('Set LABOS_PHASE2_PREFERENCES_PROBE=1');
const users=[randomUUID(),randomUUID()];const marker='LABOS-P2-PREF-'+randomUUID();const keys=[];
async function request(method,path,body,user=users[0],key){
  const r=await fetch('http://127.0.0.1:4000/api'+path,{method,headers:{Authorization:'Bearer '+jwt.sign({userId:user},config.jwtSecret,{expiresIn:'10m'}),'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json().catch(()=>null)};
}
function intent(value,version,depends=null,user=users[0]){const key=randomUUID();keys.push(key);return{change_id:key,entity_type:'daily_preferences',entity_id:user,operation:'update',payload:{notifications_enabled:value,expected_version:version,depends_on:depends}};}
async function push(changes,user=users[0],device='preference-device-a'){const r=await request('POST','/sync/push',{device_id:device,changes},user);assert.equal(r.status,200,JSON.stringify(r));return r.body.results;}
async function notify(user=users[0]){return pool.query("INSERT INTO notifications(user_id,type,title,body) VALUES($1,'test',$2,'preference probe') RETURNING id",[user,marker]);}
try{
  for(const [i,id] of users.entries())await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-login','viewer')",[id,marker+i]);
  let p=await request('GET','/system/daily-preferences');assert.equal(p.body.notifications_enabled,true);assert.equal(p.body.sync_version,0);
  assert.equal((await pool.query('SELECT 1 FROM user_daily_use_preferences WHERE user_id=$1',[users[0]])).rowCount,0,'GET must not write');
  const one=intent(false,0);const both=await Promise.all([push([one]),push([one])]);for(const r of both)assert.equal(r[0].status,'synced',JSON.stringify(r));
  assert.equal((await notify()).rowCount,0,'Delivery disabled, not just stored');assert.equal((await notify(users[1])).rowCount,1);
  assert.equal((await push([intent(true,0)]))[0].error.code,'SYNC_CONFLICT');
  const same=intent(false,0);assert.equal((await push([same],users[0],'preference-device-b'))[0].status,'synced','Same desired value can converge');
  const follow=intent(true,1,same.change_id);assert.equal((await push([follow],users[0],'preference-device-b'))[0].status,'synced');
  assert.equal((await notify()).rowCount,1);
  assert.equal((await push([intent(false,2,null,users[1])]))[0].error.code,'PREFERENCE_ACCOUNT_MISMATCH');
  await pool.query('UPDATE user_daily_use_preferences SET auto_pause_music=true,music_volume=.43 WHERE user_id=$1',[users[0]]);
  p=await request('GET','/system/daily-preferences');assert.equal(p.body.legacy_media.music_volume,.43);
  const key=randomUUID();keys.push(key);const body={notifications_enabled:false,expected_version:p.body.sync_version};
  for(let i=0;i<2;i++){
    const response=await request('PATCH','/system/daily-preferences',body,users[0],key);
    assert.equal(response.status,200,JSON.stringify(response));
  }
  assert.equal((await request('PATCH','/system/daily-preferences',{...body,notifications_enabled:true},users[0],key)).status,409,'A replay cannot change its payload');
  assert.equal((await request('PATCH','/system/daily-preferences',body,users[1],key)).status,409,'A replay cannot change its owner');
  assert.equal((await request('GET','/system/daily-preferences')).body.legacy_media.music_volume,.43,'Account writes preserve historical media');
  const badKey=randomUUID();keys.push(badKey);assert.equal((await request('PATCH','/system/daily-preferences',{...body,music_volume:.9},users[0],badKey)).status,400);
  assert.equal((await push([one],users[1]))[0].error.code,'IDEMPOTENCY_OWNERSHIP_MISMATCH');
  assert.equal((await request('GET','/system/daily-preferences',undefined,users[1])).body.notifications_enabled,true);
  await pool.query('UPDATE users SET is_active=false WHERE id=$1',[users[0]]);
  assert.equal((await request('GET','/system/daily-preferences')).status,401);assert.equal((await notify()).rowCount,0);
  console.log('PASS PostgreSQL hybrid preferences: read-only defaults, parallel replay, same-value convergence, conflicting edit, predecessor, account ownership, real delivery gate, HTTP retry, retained legacy music, strict fields and disabled account.');
}finally{
  await pool.query('DELETE FROM sync_idempotency WHERE change_id=ANY($1::text[])',[keys]);
  await pool.query('DELETE FROM notifications WHERE user_id=ANY($1::uuid[])',[users]);
  await pool.query('DELETE FROM audit_log WHERE actor_user_id=ANY($1::uuid[])',[users]);
  await pool.query('DELETE FROM user_daily_use_preferences WHERE user_id=ANY($1::uuid[])',[users]);
  await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await pool.end();
}
