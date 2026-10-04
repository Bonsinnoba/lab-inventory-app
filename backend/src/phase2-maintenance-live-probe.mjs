// Actual configured PostgreSQL only. Fixtures are namespaced and removed by ID.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
if(process.env.LABOS_PHASE2_MAINTENANCE_PROBE!=='1')throw new Error('Set LABOS_PHASE2_MAINTENANCE_PROBE=1');
const marker='LABOS-P2-MAINT-'+randomUUID();
const ids={item:randomUUID(),item2:randomUUID(),user:randomUUID(),record:randomUUID(),http:randomUUID(),cascade:randomUUID()};
const keys=[];const device=randomUUID();
async function request(method,path,body,user=ids.user,key){
  const r=await fetch('http://127.0.0.1:4000/api'+path,{method,headers:{Authorization:'Bearer '+jwt.sign({userId:user},config.jwtSecret,{expiresIn:'10m'}),'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,body:await r.json().catch(()=>null)};
}
function change(operation,record,version=0,dependency=null){const key=randomUUID();keys.push(key);return{change_id:key,entity_type:'maintenance_record',entity_id:record.id,operation,payload:{record,expected_version:version,depends_on:dependency}};}
async function push(changes,user=ids.user){const r=await request('POST','/sync/push',{device_id:device,changes},user);assert.equal(r.status,200,JSON.stringify(r));return r.body.results;}
function synced(results){for(const r of results)assert.equal(r.status,'synced',JSON.stringify(r));}
async function row(id=ids.record){return(await pool.query('SELECT * FROM maintenance_records WHERE id=$1',[id])).rows[0];}
try{
  await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'test-not-login','researcher')",[ids.user,marker]);
  for(const id of [ids.item,ids.item2])await pool.query("INSERT INTO items(id,name,type,status,initial_quantity,current_quantity) VALUES($1,$2,'equipment','available',1,1)",[id,marker]);
  const record={id:ids.record,item_id:ids.item,notes:marker,status:'scheduled',maintenance_type:'inspection'};
  const create=change('create',record);
  const both=await Promise.all([push([create]),push([create])]);both.forEach(synced);
  assert.equal((await row()).created_by,ids.user);assert.equal((await row()).sync_version,1);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM sync_idempotency WHERE change_id=$1',[create.change_id])).rows[0].n,1);
  assert.equal((await push([{...create,payload:{...create.payload,record:{...record,notes:'changed-key-payload'}}}]))[0].error.code,'IDEMPOTENCY_PAYLOAD_MISMATCH');
  const update=change('update',{...record,status:'completed'},1,create.change_id);
  const update2=change('update',{...record,status:'completed',notes:marker+' second'},2,update.change_id);
  synced(await push([update,update2]));synced(await push([update,update2]));
  assert.equal((await row()).sync_version,3);assert.equal((await row()).performed_by,ids.user);
  const stale=change('update',{...record,notes:'stale'},1);
  const later=change('update',{...record,notes:'must not overwrite'},3,stale.change_id);
  const rejected=await push([stale,later]);assert.equal(rejected[0].error.code,'SYNC_CONFLICT');assert.equal(rejected[1].error.code,'SYNC_DEPENDENCY_PENDING');
  assert.equal((await row()).notes,marker+' second');
  assert.equal((await push([change('update',{...record,item_id:ids.item2},3)]))[0].error.code,'MAINTENANCE_PARENT_MISMATCH');
  assert.equal((await push([change('update',{...record,scheduled_date:'2026-02-30'},3)]))[0].error.code,'INVALID_MAINTENANCE');
  await pool.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,'inventory.edit','deny')",[ids.user]);
  assert.equal((await push([change('delete',record,3)]))[0].error.code,'PERMISSION_DENIED');
  await pool.query('DELETE FROM user_permission_overrides WHERE user_id=$1',[ids.user]);
  const pull=await request('GET','/sync/maintenance/pull');assert.equal(pull.body.snapshot_complete,true);assert.equal(pull.body.records.filter(r=>r.id===ids.record).length,1);
  const path='/items/'+ids.item+'/maintenance';
  const httpKey=randomUUID();keys.push(httpKey);
  const httpBody={id:ids.http,notes:marker};
  const h1=await request('POST',path,httpBody,ids.user,httpKey);assert.equal(h1.status,201,JSON.stringify(h1));
  assert.equal((await request('POST',path,httpBody,ids.user,httpKey)).body.id,ids.http);
  const patchKey=randomUUID();keys.push(patchKey);
  const h2=await request('PATCH',path+'/'+ids.http,{notes:marker+' HTTP',expected_version:1},ids.user,patchKey);assert.equal(h2.status,200,JSON.stringify(h2));assert.equal(h2.body.sync_version,2);
  const staleKey=randomUUID();keys.push(staleKey);
  assert.equal((await request('PATCH',path+'/'+ids.http,{notes:'stale',expected_version:1},ids.user,staleKey)).status,409);
  const deleteKey=randomUUID();keys.push(deleteKey);
  for(let i=0;i<2;i++)assert.equal((await request('DELETE',path+'/'+ids.http,{expected_version:2},ids.user,deleteKey)).status,200);
  const deleted=change('delete',record,3);synced(await push([deleted]));synced(await push([deleted]));assert.equal(await row(),undefined);
  assert.equal((await push([change('create',record)]))[0].error.code,'SYNC_CONFLICT','Deleted UUID must not resurrect');
  const cascade=change('create',{...record,id:ids.cascade,item_id:ids.item2});synced(await push([cascade]));
  await pool.query('DELETE FROM items WHERE id=$1',[ids.item2]);
  assert.equal((await pool.query("SELECT 1 FROM sync_tombstones WHERE entity_type='maintenance_record' AND entity_id=$1",[ids.cascade])).rowCount,1);
  await pool.query('UPDATE users SET is_active=false WHERE id=$1',[ids.user]);assert.equal((await request('GET','/sync/maintenance/pull')).status,401);
  console.log('PASS: PostgreSQL maintenance parallel replay, payload mismatch, author, ordered dependent edits, stale/conflicting/dependent rejection, parent/date validation, revocation, HTTP idempotency/versioning, tombstones, no resurrection, cascade delete and disabled user.');
}finally{
  await pool.query('DELETE FROM maintenance_records WHERE id=ANY($1::uuid[])',[[ids.record,ids.http,ids.cascade]]);
  await pool.query('DELETE FROM items WHERE id=ANY($1::uuid[]) AND name=$2',[[ids.item,ids.item2],marker]);
  await pool.query('DELETE FROM sync_idempotency WHERE change_id=ANY($1::text[])',[keys]);
  await pool.query("DELETE FROM sync_tombstones WHERE entity_type='maintenance_record' AND entity_id=ANY($1::uuid[])",[[ids.record,ids.http,ids.cascade]]);
  await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1',[ids.user]);
  await pool.query('DELETE FROM user_permission_overrides WHERE user_id=$1',[ids.user]);
  await pool.query('DELETE FROM users WHERE id=$1 AND username=$2',[ids.user,marker]);await pool.end();
}
