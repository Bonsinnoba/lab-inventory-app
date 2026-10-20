// Run only through the explicit rollback probe launcher. Sources/migration arrive
// in memory; no API files are overwritten and the final transaction never commits.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from 'file:///app/src/db.js';

const packet=globalThis.labosCustodyProbe;
if(!packet?.source || !packet?.migration || !packet?.baseline) throw Error('Explicit probe sources required');
const moduleFrom=source=>import('data:text/javascript;base64,'+Buffer.from(source.replace("'./reservation-stock.js'","'file:///app/src/reservation-stock.js'")).toString('base64'));
const current=await moduleFrom(packet.source), baseline=await moduleFrom(packet.baseline);
const client=await pool.connect(), actor=randomUUID(), recipient=randomUUID(), item=randomUUID();
const results=[];let failures=0,savepoint=0;
const change=(payload)=>({entity_type:'item_movement',entity_id:item,operation:'create',payload:{id:randomUUID(),item_id:item,...payload}});
const apply=payload=>current.applyInventoryRaw(client,change(payload),actor);
async function rejected(action,code){
  const name='probe_'+(++savepoint);await client.query(`SAVEPOINT ${name}`);
  try {await assert.rejects(action,error=>error.code===code);}
  finally {await client.query(`ROLLBACK TO SAVEPOINT ${name}`);await client.query(`RELEASE SAVEPOINT ${name}`);}
}
async function check(name,fn,dependencies=[]){
  if(dependencies.some(index=>results[index]?.status!=='PASS')){results.push({name,status:'BLOCKED',dependencies});failures++;return;}
  const point='check_'+(++savepoint);await client.query(`SAVEPOINT ${point}`);
  try{await fn();results.push({name,status:'PASS'});}
  catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${point}`);failures++;results.push({name,status:'FAIL',message:error.message,code:error.code});}
  finally{await client.query(`RELEASE SAVEPOINT ${point}`);}
}
try{
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout='2s'");await client.query("SET LOCAL statement_timeout='10s'");
  const existed=(await client.query("SELECT to_regclass('item_custody_records')::text AS custody")).rows[0].custody;
  // Exact custody DDL from the proposed migration, without unrelated B3 ALTERs.
  const offset=packet.migration.indexOf('-- 2. Item custody records');
  assert.ok(offset>=0,'Custody migration marker missing');
  await client.query(packet.migration.slice(offset));
  await client.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'probe-no-login','member',true),($3,$4,'probe-no-login','member',true)",[actor,'p2-custody-'+actor,recipient,'p2-custody-'+recipient]);
  await client.query("INSERT INTO items(id,name,type,current_quantity,initial_quantity,storage_location) VALUES($1,'Rollback-only custody probe','component',10,10,'Shelf A')",[item]);
  await check('baseline issue reproduces immediate movement FK failure',()=>rejected(()=>baseline.applyInventoryRaw(client,change({movement_type:'checkout',quantity:4,recipient_id:actor}),actor),'23503'));
  const issued=await apply({movement_type:'checkout',quantity:4,recipient_id:actor});
  await check('issue uses movement-first FK ordering and stable custody identity',async()=>{
    assert.equal(Number(issued.item.current_quantity),6);assert.equal(issued.custody_record.id,issued.movement.id);
    assert.equal(issued.custody_record.source_movement_id,issued.movement.id);assert.equal(Number(issued.custody_record.outstanding_quantity),4);
  });
  const custody=issued.custody_record.id;
  await check('partial return credits only returned quantity',async()=>{
    const r=await apply({movement_type:'return',quantity:1,custody_id:custody});assert.equal(Number(r.item.current_quantity),7);
    assert.equal(Number((await client.query('SELECT outstanding_quantity FROM item_custody_records WHERE id=$1',[custody])).rows[0].outstanding_quantity),3);
  });
  await check('consumption and recipient transfer do not debit storeroom again',async()=>{
    const consumed=await apply({movement_type:'consume',quantity:1,custody_id:custody});assert.equal(Number(consumed.item.current_quantity),7);
    const transferred=await apply({movement_type:'transfer',quantity:1,custody_id:custody,transfer_recipient_id:recipient});
    assert.equal(Number(transferred.item.current_quantity),7);assert.equal(transferred.item.storage_location,'Shelf A');
    assert.equal(transferred.custody_record.recipient_id,recipient);assert.equal(transferred.custody_record.id,transferred.movement.id);
    assert.equal(Number(transferred.custody_record.outstanding_quantity),1);
  },[2]);
  await check('bad settlement type, excess quantity and same-recipient transfer reject',async()=>{
    await rejected(()=>apply({movement_type:'consume',quantity:1,custody_id:custody,settlement_type:'invented'}),'INVALID_SETTLEMENT_TYPE');
    await rejected(()=>apply({movement_type:'return',quantity:2,custody_id:custody}),'EXCESSIVE_SETTLEMENT');
    await rejected(()=>apply({movement_type:'transfer',quantity:1,custody_id:custody,transfer_recipient_id:actor}),'SAME_CUSTODY_RECIPIENT');
  },[3]);
  await check('unknown recipients and fractional serial issues reject without stock changes',async()=>{
    await rejected(()=>apply({movement_type:'checkout',quantity:1,recipient_id:randomUUID()}),'RECIPIENT_UNAVAILABLE');
    await rejected(async()=>{await client.query('UPDATE users SET is_active=false WHERE id=$1',[recipient]);await apply({movement_type:'checkout',quantity:1,recipient_id:recipient});},'RECIPIENT_UNAVAILABLE');
    await rejected(()=>apply({movement_type:'checkout',quantity:0.5,recipient_id:actor,serial_number:'SN-PROBE'}),'SERIAL_QUANTITY');
    await rejected(()=>apply({movement_type:'checkout',quantity:0.0001,recipient_id:actor}),'INVALID_CUSTODY_QUANTITY');
    assert.equal(Number((await client.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),7);
  },[3]);
  await check('decimal settlements reach exact zero and legacy explicit damage is not consumption',async()=>{
    const decimal=await apply({movement_type:'checkout',quantity:0.3,recipient_id:actor});
    await apply({movement_type:'consume',quantity:0.1,custody_id:decimal.custody_record.id});
    const end=await apply({movement_type:'consume',settlement_type:'damage',quantity:0.2,custody_id:decimal.custody_record.id});
    assert.equal(end.movement.movement_type,'damage');assert.equal(end.custody_settlement.settlement_type,'damage');
    const row=(await client.query('SELECT outstanding_quantity,status FROM item_custody_records WHERE id=$1',[decimal.custody_record.id])).rows[0];
    assert.equal(Number(row.outstanding_quantity),0);assert.equal(row.status,'settled');
  });
  await check('duplicate movement identity cannot apply stock twice',()=>rejected(()=>current.applyInventoryRaw(client,{entity_type:'item_movement',operation:'create',entity_id:item,payload:{...issued.movement,recipient_id:actor}},actor),'MOVEMENT_ALREADY_EXISTS'));
  await client.query('ROLLBACK');
  const persisted=(await client.query('SELECT count(*)::int AS count FROM items WHERE id=$1',[item])).rows[0].count;
  assert.equal(persisted,0,'Probe item persisted unexpectedly');
  assert.equal((await client.query('SELECT count(*)::int AS count FROM users WHERE id=ANY($1::uuid[])',[[actor,recipient]])).rows[0].count,0,'Probe users persisted unexpectedly');
  assert.equal((await client.query("SELECT to_regclass('item_custody_records')::text AS custody")).rows[0].custody,existed);
  console.log(JSON.stringify({database:'existing PostgreSQL',rollback_verified:true,passed:results.filter(r=>r.status==='PASS').length,failed:failures,results}));
}finally{await client.query('ROLLBACK').catch(()=>{});client.release();await pool.end();}
if(failures)process.exitCode=1;
