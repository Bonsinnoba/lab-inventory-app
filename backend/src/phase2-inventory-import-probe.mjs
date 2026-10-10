import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
if(process.env.LABOS_PHASE2_INVENTORY_PROBE!=='1')throw Error('Explicit probe opt-in required');
const users=[randomUUID(),randomUUID()],ids=[randomUUID(),randomUUID(),randomUUID()].sort(),marker='LABOS-P2-INVENTORY-IMPORT-'+randomUUID(),device=randomUUID();
async function http(path,body,user=users[0],key=randomUUID()){
 const r=await fetch('http://127.0.0.1:4000/api'+path,{method:'POST',headers:{Authorization:'Bearer '+jwt.sign({userId:user},config.jwtSecret,{expiresIn:'15m'}),'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};
}
const record=id=>({id,name:marker,type:'component',initial_quantity:10,current_quantity:10});
const make=(version=1,quantity=10)=>({inventory_protocol:2,rows:[{operation:'create',record:record(ids[0])},{operation:'update',record:{...record(ids[1]),current_quantity:quantity}}],item_bases:[{id:ids[0],version:0,depends_on:null},{id:ids[1],version,depends_on:null}]});
const item=async id=>(await pool.query('SELECT * FROM items WHERE id=$1',[id])).rows[0];
async function push(change,user=users[0]){const r=await http('/sync/push',{device_id:device,changes:[change]},user);assert.equal(r.status,200,JSON.stringify(r));return r.body.results[0];}
try{
 for(const [i,id] of users.entries())await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-login',$3)",[id,marker+i,i?'viewer':'admin']);
 await pool.query("INSERT INTO items(id,name,type,initial_quantity,current_quantity) VALUES($1,$2,'component',10,10)",[ids[1],marker]);
 const stale=await http('/excel/inventory/import',make(999));assert.equal(stale.status,409,JSON.stringify(stale));assert.equal(await item(ids[0]),undefined);assert.equal((await item(ids[1])).sync_version,1);
 assert.equal((await pool.query('SELECT count(*)::int n FROM audit_log WHERE actor_user_id=$1',[users[0]])).rows[0].n,0);
 await pool.query("INSERT INTO user_permission_overrides(user_id,permission,effect) SELECT $1,unnest(ARRAY['inventory.create','inventory.edit','inventory.import']),'grant'",[users[1]]);
 const denied=await http('/excel/inventory/import',make(1,8),users[1]);assert.equal(denied.status,403,JSON.stringify(denied));assert.equal(await item(ids[0]),undefined);
 // Missing import privilege is also rejected on the sync broker path.
 await pool.query("DELETE FROM user_permission_overrides WHERE user_id=$1 AND permission='inventory.import'",[users[1]]);
 const noImport=await push({change_id:randomUUID(),entity_type:'item',operation:'import',payload:make()},users[1]);assert.equal(noImport.error.code,'PERMISSION_DENIED');
 const key=randomUUID(),payload=make();for(const r of await Promise.all([http('/excel/inventory/import',payload,users[0],key),http('/excel/inventory/import',payload,users[0],key)])){assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(r.body,{imported:2,created:1,updated:1});}
 assert.equal((await item(ids[0])).sync_version,1);assert.equal((await item(ids[1])).sync_version,2);
 assert.equal((await pool.query('SELECT count(*)::int n FROM audit_log WHERE actor_user_id=$1',[users[0]])).rows[0].n,2);
 const mismatch=await http('/excel/inventory/import',make(2,5),users[0],key);assert.equal(mismatch.status,409);
 // A whole import receipt is a valid predecessor for the next per-item intent.
 const batch={change_id:randomUUID(),entity_type:'item',operation:'import',payload:{inventory_protocol:2,rows:[{operation:'create',record:record(ids[2])},{operation:'update',record:{...record(ids[1]),current_quantity:7}}],item_bases:[{id:ids[2],version:0},{id:ids[1],version:2}]}};
 assert.equal((await push(batch)).status,'synced');assert.equal((await push(batch)).status,'synced');assert.equal(Number((await item(ids[1])).current_quantity),7);
 const dependent={change_id:randomUUID(),entity_type:'item',entity_id:ids[2],operation:'update',payload:{id:ids[2],patch:{name:marker+' linked'},inventory_protocol:2,item_bases:[{id:ids[2],version:1,depends_on:batch.change_id}]}};
 assert.equal((await push(dependent)).status,'synced');assert.equal((await item(ids[2])).sync_version,2);
 assert.equal((await pool.query('SELECT count(*)::int n FROM sync_idempotency WHERE user_id=$1',[users[0]])).rows[0].n,3);
 console.log('PASS actual PostgreSQL inventory imports: atomic rollback after earlier create, stock/import permission enforcement, parallel browser replay, immutable key mismatch, single sync batch replay and dependent edit.');
}finally{
 await pool.query('DELETE FROM items WHERE id=ANY($1::uuid[])',[ids]);await pool.query("DELETE FROM sync_tombstones WHERE entity_type='item' AND entity_id=ANY($1::uuid[])",[ids]);
 for(const table of ['sync_idempotency','notifications','user_permission_overrides'])await pool.query(`DELETE FROM ${table} WHERE user_id=ANY($1::uuid[])`,[users]);
 await pool.query('DELETE FROM audit_log WHERE actor_user_id=ANY($1::uuid[])',[users]);await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await pool.end();
}
