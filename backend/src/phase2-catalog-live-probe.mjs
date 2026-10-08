import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
if(process.env.LABOS_PHASE2_CATALOG_PROBE!=='1')throw Error('Explicit catalog test opt-in required');
const users=[randomUUID(),randomUUID()],ids=[],keys=[],item=randomUUID(),marker='LABOS-P2-CATALOG-'+randomUUID();
async function http(method,path,body,user=users[0],key){
  const r=await fetch('http://127.0.0.1:4000/api'+path,{method,headers:{Authorization:'Bearer '+jwt.sign({userId:user},config.jwtSecret,{expiresIn:'10m'}),'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return{status:r.status,body:await r.json().catch(()=>null)};
}
function change(kind,id,op,version,record={},depends=null){const key=randomUUID();keys.push(key);return{change_id:key,entity_type:kind,entity_id:id,operation:op,payload:{record:{...record,id},expected_version:version,depends_on:depends}};}
async function push(changes,user=users[0]){const r=await http('POST','/sync/push',{device_id:'catalog-probe',changes},user);assert.equal(r.status,200,JSON.stringify(r));return r.body.results;}
try{
  for(const [i,user] of users.entries())await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-login',$3)",[user,marker+i,i?'viewer':'admin']);
  for(const kind of ['supplier','storage_container']){
    const id=randomUUID();ids.push(id);const one=change(kind,id,'create',0,{name:marker+kind,...(kind==='storage_container'?{capacity:2.5}:{})});
    const parallel=await Promise.all([push([one]),push([one])]);
    for(const r of parallel)assert.equal(r[0].status,'synced',JSON.stringify(r));
    const table=kind==='supplier'?'suppliers':'storage_containers';
    assert.equal((await pool.query(`SELECT created_by FROM ${table} WHERE id=$1`,[id])).rows[0].created_by,users[0]);
    const changed=structuredClone(one);changed.payload.record.name+='changed';assert.equal((await push([changed]))[0].error.code,'IDEMPOTENCY_PAYLOAD_MISMATCH');
    const wrongEntity={...one,entity_id:randomUUID()};assert.equal((await push([wrongEntity]))[0].error.code,'IDEMPOTENCY_OWNERSHIP_MISMATCH');
    const edit=change(kind,id,'update',1,{notes:'offline second'},one.change_id);
    const edit2=change(kind,id,'update',2,{notes:'offline third'},edit.change_id);
    for(const r of await push([edit,edit2]))assert.equal(r.status,'synced',JSON.stringify(r));
    assert.equal((await push([change(kind,id,'update',1,{notes:'stale'})]))[0].error.code,'SYNC_CONFLICT');
    assert.equal((await push([change(kind,id,'update',3,{notes:'blocked'},randomUUID())]))[0].error.code,'SYNC_DEPENDENCY_PENDING');
    assert.equal((await push([change(kind,id,'update',3,{notes:'forbidden'})],users[1]))[0].error.code,'PERMISSION_DENIED');
    const pull=await http('GET',`/sync/catalog/${kind}/pull`);assert.equal(pull.status,200);assert.equal(pull.body.snapshot_complete,true);
    assert.equal(pull.body.records.filter(r=>r.id===id).length,1);assert.equal(pull.body.records.find(r=>r.id===id).sync_version,3);
    const path=(kind==='supplier'?'/operations/suppliers':'/phase4/containers')+'/'+id;
    const key=randomUUID();keys.push(key);const payload={notes:'HTTP edit',expected_version:3};
    const a=await http('PATCH',path,payload,users[0],key),b=await http('PATCH',path,payload,users[0],key);assert.equal(a.status,200,JSON.stringify(a));assert.deepEqual(a,b);
    assert.equal((await http('PATCH',path,{...payload,notes:'not same'},users[0],key)).status,409);
    assert.equal((await http('PATCH',path,payload,users[1],key)).status,403);
    if(kind==='storage_container'){
      await pool.query("INSERT INTO items(id,name,type,initial_quantity,current_quantity,storage_container_id) VALUES($1,$2,'tool',1,1,$3)",[item,marker,id]);
      assert.equal((await push([change(kind,id,'delete',4)]))[0].error.code,'CONTAINER_HAS_ITEMS');
      await pool.query('DELETE FROM items WHERE id=$1',[item]);
    }
    const deletion=change(kind,id,'delete',4);assert.equal((await push([deletion]))[0].status,'synced');assert.equal((await push([deletion]))[0].status,'synced');
    assert.equal((await push([change(kind,id,'create',0,{name:'resurrect'})]))[0].error.code,'SYNC_CONFLICT');
    assert.equal((await pool.query('SELECT 1 FROM sync_tombstones WHERE entity_type=$1 AND entity_id=$2',[kind,id])).rowCount,1);
    assert.equal((await http('GET',`/sync/catalog/${kind}/pull`)).body.records.some(r=>r.id===id),false);
  }
  await pool.query('UPDATE users SET is_active=false WHERE id=$1',[users[0]]);
  assert.equal((await http('GET','/sync/catalog/supplier/pull')).status,401);
  console.log('PASS actual PostgreSQL catalogs: parallel replay, payload/entity mismatch, author, queued dependencies, stale conflicts, permission denial, complete pull, HTTP retry, linked-container guard, delete replay and no resurrection.');
}finally{
  await pool.query('DELETE FROM items WHERE id=$1',[item]);
  for(const table of ['suppliers','storage_containers'])await pool.query(`DELETE FROM ${table} WHERE id=ANY($1::uuid[])`,[ids]);
  await pool.query('DELETE FROM sync_idempotency WHERE change_id=ANY($1::text[])',[keys]);
  await pool.query('DELETE FROM sync_tombstones WHERE entity_id=ANY($1::uuid[])',[[...ids,item]]);
  await pool.query('DELETE FROM audit_log WHERE actor_user_id=ANY($1::uuid[])',[users]);
  await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await pool.end();
}
