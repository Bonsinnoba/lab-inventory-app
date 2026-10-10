import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
if(process.env.LABOS_PHASE2_INVENTORY_PROBE!=='1')throw Error('Explicit probe opt-in required');
const users=[randomUUID(),randomUUID()],ids=[randomUUID(),randomUUID(),randomUUID()],device=randomUUID(),otherDevice=randomUUID(),marker='LABOS-P2-INVENTORY-VERSIONS-'+randomUUID();
const token=uid=>jwt.sign({userId:uid},config.jwtSecret,{expiresIn:'15m'});
async function send(changes,{user=users[0],dev=device}={}){
  const r=await fetch('http://127.0.0.1:4000/api/sync/push',{method:'POST',headers:{Authorization:'Bearer '+token(user),'Content-Type':'application/json'},body:JSON.stringify({device_id:dev,changes})});assert.equal(r.status,200);return(await r.json()).results;
}
const change=(id,op,p={},v=1,dependency=null)=>({change_id:randomUUID(),entity_type:'item',entity_id:id,operation:op,payload:{id,...p,inventory_protocol:2,item_bases:[{id,version:v,depends_on:dependency}]}});
const ok=rows=>{for(const row of rows)assert.equal(row.status,'synced',JSON.stringify(row));};
const code=(rows,expected)=>assert.equal(rows[0].error?.code,expected,JSON.stringify(rows));
const item=async id=>(await pool.query('SELECT * FROM items WHERE id=$1',[id])).rows[0];
const bulk=(op,versions)=>({change_id:randomUUID(),entity_type:'item',operation:op,payload:{ids:ids.slice(0,2),status:'in_use',inventory_protocol:2,item_bases:ids.slice(0,2).map((id,i)=>({id,version:versions[i],depends_on:null}))}});
try{
  for(const [index,id] of users.entries())await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-login',$3)",[id,marker+index,index?'viewer':'admin']);
  // A create-only delegate must not need inventory.edit just to create.
  await pool.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,'inventory.create','grant')",[users[1]]);
  const delegated=change(ids[2],'create',{name:marker,type:'component',initial_quantity:10,current_quantity:10},0);
  ok(await send([delegated],{user:users[1]}));code(await send([change(ids[2],'update',{patch:{name:'denied'}},1)],{user:users[1]}),'PERMISSION_DENIED');
  const create=change(ids[0],'create',{name:marker,type:'component',initial_quantity:10,current_quantity:10},0);
  const parallel=await Promise.all([send([create]),send([create])]);parallel.forEach(ok);assert.equal((await item(ids[0])).sync_version,1);
  const first=change(ids[0],'update',{patch:{name:marker+' first'}},1,create.change_id),second=change(ids[0],'update',{patch:{name:marker+' second'}},2,first.change_id);
  ok(await send([first,second]));assert.equal((await item(ids[0])).sync_version,3);ok(await send([first,second]));assert.equal((await item(ids[0])).sync_version,3);
  code(await send([change(ids[0],'update',{patch:{name:'stale'}},1)]),'SYNC_CONFLICT');
  code(await send([change(ids[0],'update',{patch:{name:'foreign dependency'}},3,second.change_id)],{dev:otherDevice}),'SYNC_DEPENDENCY_PENDING');
  ok(await send([change(ids[1],'create',{name:marker,type:'component',initial_quantity:10,current_quantity:10},0)]));
  const third=change(ids[0],'update',{patch:{name:marker+' third'}},3);ok(await send([third]));
  ok(await send([change(ids[0],'update',{patch:{name:marker+' rival'}},4)],{dev:otherDevice}));
  code(await send([change(ids[0],'update',{patch:{name:'do not overwrite rival'}},4,third.change_id)]),'SYNC_CONFLICT');
  const auditBefore=(await pool.query('SELECT count(*)::int n FROM audit_log WHERE actor_user_id=$1',[users[0]])).rows[0].n;
  code(await send([bulk('bulk_status',[4,1])]),'SYNC_CONFLICT');assert.equal((await item(ids[1])).status,'available');assert.equal((await item(ids[1])).sync_version,1);
  code(await send([bulk('bulk_delete',[4,1])]),'SYNC_CONFLICT');assert.ok(await item(ids[1]));assert.equal((await pool.query('SELECT count(*)::int n FROM audit_log WHERE actor_user_id=$1',[users[0]])).rows[0].n,auditBefore);
  const valid=bulk('bulk_status',[5,1]);ok(await send([valid]));ok(await send([valid]));assert.equal((await item(ids[0])).sync_version,6);assert.equal((await item(ids[1])).sync_version,2);
  const movement=(kind,quantity,version,dependency=null)=>({change_id:randomUUID(),entity_type:'item_movement',entity_id:ids[0],operation:'create',payload:{id:randomUUID(),item_id:ids[0],movement_type:kind,quantity,inventory_protocol:2,item_bases:[{id:ids[0],version,depends_on:dependency}]}});
  const receive=movement('receive',5,6),consume=movement('consume',2,6);ok(await send([receive]));ok(await send([consume],{dev:otherDevice}));assert.equal(Number((await item(ids[0])).current_quantity),13);
  code(await send([movement('adjust',2,6)]),'SYNC_CONFLICT');
  // Predecessor receipt supplies the actual version after concurrent delta merge.
  const updateAfterDelta=change(ids[0],'update',{patch:{name:marker+' after delta'}},7,consume.change_id);ok(await send([updateAfterDelta],{dev:otherDevice}));assert.equal((await item(ids[0])).sync_version,9);
  // Direct SQL/legacy routes must also advance versions, even within one clock tick.
  await pool.query('UPDATE items SET name=name WHERE id=$1',[ids[0]]);assert.equal((await item(ids[0])).sync_version,10);
  code(await send([change(ids[0],'delete',{},9)]),'SYNC_CONFLICT');
  const deletion=change(ids[0],'delete',{},10);ok(await send([deletion]));ok(await send([deletion]));assert.equal(await item(ids[0]),undefined);
  code(await send([change(ids[0],'create',{name:marker,type:'tool'},0)]),'SYNC_CONFLICT');
  const count=(await pool.query("SELECT count(*)::int n FROM audit_log WHERE metadata->>'change_id'=$1",[create.change_id])).rows[0].n;assert.equal(count,1);
  const beforeMigration=(await item(ids[1])).sync_version;
  await pool.query(readFileSync(new URL('./migrations/20261009_inventory_versions.sql',import.meta.url),'utf8'));
  assert.equal((await item(ids[1])).sync_version,beforeMigration,'Migration rerun must not alter existing versions');
  // More than a page at the same microsecond exposes lossy JS Date cursors.
  const many=(await pool.query("INSERT INTO items(name,type,status,updated_at) SELECT $1,'component','available','2026-10-08T00:00:00.123456Z'::timestamptz FROM generate_series(1,600) RETURNING id",[marker+'-cursor'])).rows.map(r=>r.id);ids.push(...many);
  const expected=new Set(many),seen=new Set();let cursor='';let ended=false;
  for(let page=0;page<100;page++){
    const r=await fetch('http://127.0.0.1:4000/api/sync/pull?limit=100'+(cursor?'&since='+encodeURIComponent(cursor):''),{headers:{Authorization:'Bearer '+token(users[0])}});assert.equal(r.status,200);const body=await r.json();
    for(const row of body.items){if(expected.has(row.id)){assert.ok(!seen.has(row.id),'Cursor repeated a fixture row');seen.add(row.id);}}
    if(!body.has_more){ended=true;break}assert.ok(body.next_cursor&&body.next_cursor!==cursor);cursor=body.next_cursor;
  }
  assert.ok(ended,'Cursor must terminate');assert.equal(seen.size,600);
  console.log('PASS real PostgreSQL inventory versions: create-only delegate, parallel replay, sequential predecessors, stale/rival edits, cross-device dependency rejection, atomic bulk rollback, additive vs absolute stock, actual predecessor versions, delete/replay/no resurrection, exactly-once audit, repeat migration and 600-record microsecond pagination.');
}finally{
  await pool.query('DELETE FROM item_movements WHERE item_id=ANY($1::uuid[])',[ids]);
  await pool.query('DELETE FROM items WHERE id=ANY($1::uuid[])',[ids]);
  await pool.query("DELETE FROM sync_tombstones WHERE entity_type='item' AND entity_id=ANY($1::uuid[])",[ids]);
  await pool.query('DELETE FROM sync_idempotency WHERE user_id=ANY($1::uuid[])',[users]);
  await pool.query('DELETE FROM audit_log WHERE actor_user_id=ANY($1::uuid[])',[users]);
  await pool.query('DELETE FROM notifications WHERE user_id=ANY($1::uuid[])',[users]);
  await pool.query('DELETE FROM user_permission_overrides WHERE user_id=ANY($1::uuid[])',[users]);
  await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await pool.end();
}
