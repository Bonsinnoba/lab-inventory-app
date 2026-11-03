import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {releaseSalvage} from './salvage-release.js';
import {applySalvageIntent} from './salvage-intents.js';
import {applyInventoryMutation} from './inventory-sync.js';

// Run only with development Compose. Fixtures are committed to exercise real
// independent transactions, then removed by their generated, owned identities.
if(process.env.LABOS_DEV_SALVAGE_CONCURRENCY_PROBE!=='isolated-fixtures'||process.env.PGHOST!=='db'||process.env.LABOS_DEV_EXPECT_DATABASE!=='lab_inventory')throw Error('Explicit development database opt-in required');
const observer=await pool.connect(),a=await pool.connect(),b=await pool.connect();
const actor=randomUUID(),items=[],recoveries=[],batches=[],custodies=[];
const tx=async c=>{await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='12s'");await c.query("SET LOCAL lock_timeout='8s'");};
async function item(){const id=randomUUID();items.push(id);await observer.query("INSERT INTO items(id,name,type,current_quantity,initial_quantity,unit) VALUES($1,'Salvage concurrency fixture','component',10,10,'each')",[id]);return id;}
async function recovery(itemId,movement=null){const id=randomUUID();recoveries.push(id);await observer.query(`INSERT INTO item_salvage_recoveries(id,source_item_id,source_movement_id,recovered_item_id,recovery_type,recovered_item_name,source_quantity,recovered_quantity,unit,quarantine_status,condition,quarantined_by,attestation_notes)
 VALUES($1,$2,$3,$4,'component_recovery','Concurrency fixture',2,2,'each','inspected_approved','good',$5,'Explicit test-only historical source')`,[id,movement?itemId:null,movement,itemId,actor]);return id;}
const stock=async id=>Number((await observer.query('SELECT current_quantity FROM items WHERE id=$1',[id])).rows[0].current_quantity);
const ledger=async id=>(await observer.query("SELECT quantity_before,quantity_after FROM item_movements WHERE reference=$1",[`salvage:${id}`])).rows;
async function blocked(blocker,waiter){for(let i=0;i<30;i++){if((await observer.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked',[blocker,waiter])).rows[0].blocked)return;await observer.query('SELECT pg_sleep(0.03)');}throw Error('Expected independent transaction to wait on the competing writer');}
let aPid,bPid;
async function race(first,second,secondApply=releaseSalvage){
 let pending;
 try{
  await tx(a);await tx(b);
  const winner=await releaseSalvage(a,first,actor);
  pending=secondApply(b,second,actor).then(value=>({ok:true,value}),error=>({ok:false,error}));
  await blocked(aPid,bPid);await a.query('COMMIT');
  const follower=await pending;await b.query(follower.ok?'COMMIT':'ROLLBACK');return{winner,follower};
 }catch(error){await a.query('ROLLBACK');if(pending)await pending;await b.query('ROLLBACK');throw error;}
}
try{
 assert.equal((await observer.query('SELECT current_database() AS name')).rows[0].name,process.env.LABOS_DEV_EXPECT_DATABASE);
 assert.equal((await observer.query('SHOW default_transaction_isolation')).rows[0].default_transaction_isolation,'read committed');
 aPid=(await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;bPid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
 await observer.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'no-login-fixture','admin',true)",[actor,`salvage-race-${actor}`]);
 const sameItem=await item(),same=await recovery(sameItem);
 const replay=await race(same,same);assert.equal(replay.follower.ok,true);assert.equal(await stock(sameItem),12);assert.equal((await ledger(same)).length,1);
 console.log('PASS: overlapping same-recovery release commits once; blocked follower observes released state.');

 const sourceItem=await item(),movement=randomUUID();
 await observer.query("INSERT INTO item_movements(id,item_id,movement_type,quantity,quantity_before,quantity_after,performed_by) VALUES($1,$2,'consume',3,13,10,$3)",[movement,sourceItem,actor]);
 const first=await recovery(sourceItem,movement),excess=await recovery(sourceItem,movement);
 const claims=await race(first,excess);assert.equal(claims.follower.ok,false);assert.equal(claims.follower.error.code,'SALVAGE_SOURCE_EXHAUSTED');assert.equal(await stock(sourceItem),12);assert.equal((await ledger(excess)).length,0);
 console.log('PASS: concurrent claims serialize on consumption source; excess claim stays quarantined without stock credit.');

 const assembly=await item(),batchMovement=randomUUID(),batchId=randomUUID(),otherOutput=randomUUID();batches.push(batchId);recoveries.push(batchId,otherOutput);
 await observer.query("INSERT INTO item_movements(id,item_id,movement_type,quantity,quantity_before,quantity_after,performed_by) VALUES($1,$2,'consume',2,12,10,$3)",[batchMovement,assembly,actor]);
 await tx(observer);
 try{
  await applySalvageIntent(observer,{entity_id:batchId,operation:'create_batch',payload:{record:{source_movement_id:batchMovement,source_quantity:2,outputs:[batchId,otherOutput].map(id=>({id,recovered_item_name:'Dismantled fixture',recovery_type:'disassembly_output',recovered_quantity:2,unit:'each'}))}}},{userId:actor});
  await observer.query("UPDATE item_salvage_recoveries SET quarantine_status='inspected_approved',condition='good',recovered_item_id=$1 WHERE batch_id=$2",[assembly,batchId]);
  await observer.query('COMMIT');
 }catch(error){await observer.query('ROLLBACK');throw error;}
 const outputs=await race(batchId,otherOutput);assert.equal(outputs.follower.ok,true);assert.equal(await stock(assembly),14);
 const extraClaim=await recovery(assembly,batchMovement);
 await tx(a);try{await assert.rejects(()=>releaseSalvage(a,extraClaim,actor),error=>error.code==='SALVAGE_SOURCE_EXHAUSTED');}finally{await a.query('ROLLBACK');}
 assert.equal((await ledger(batchId)).length,1);assert.equal((await ledger(otherOutput)).length,1);assert.equal((await ledger(extraClaim)).length,0);
 console.log('PASS: concurrent outputs of one disassembly each credit once while sharing one source claim; a later standalone claim is denied.');

 const heldItem=await item(),heldId=randomUUID();custodies.push(heldId);
 await observer.query("INSERT INTO item_custody_records(id,item_id,recipient_id,issued_by,initial_quantity,outstanding_quantity,unit) VALUES($1,$2,$3,$3,1,1,'each')",[heldId,heldItem,actor]);
 const heldRecovery=await recovery(heldItem);
 await observer.query("UPDATE item_salvage_recoveries SET source_item_id=$1,source_custody_id=$2,source_quantity=1,recovered_quantity=1,recovery_type='equipment_return' WHERE id=$3",[heldItem,heldId,heldRecovery]);
 const normalReturnId=randomUUID();
 const competingReturn=await race(heldRecovery,heldRecovery,client=>applyInventoryMutation(client,{change_id:randomUUID(),entity_type:'item_movement',entity_id:heldItem,operation:'create',payload:{id:normalReturnId,item_id:heldItem,movement_type:'return',custody_id:heldId,quantity:1}},{userId:actor,role:'admin'}));
 assert.equal(competingReturn.follower.ok,false);assert.equal(competingReturn.follower.error.code,'CUSTODY_SETTLED');assert.equal(await stock(heldItem),11);
 assert.equal(Number((await observer.query('SELECT outstanding_quantity FROM item_custody_records WHERE id=$1',[heldId])).rows[0].outstanding_quantity),0);
 assert.equal((await observer.query('SELECT 1 FROM item_custody_settlements WHERE custody_id=$1',[heldId])).rowCount,1);
 console.log('PASS: inspected custody return and ordinary return serialize without deadlock, settle once and restore stock once.');

 const quarantinedItem=await item();let blockedIssue;
 try{
  await tx(a);await tx(b);
  await a.query('SELECT id FROM items WHERE id=$1 FOR UPDATE',[quarantinedItem]);
  await a.query("UPDATE items SET status='needs_repair' WHERE id=$1",[quarantinedItem]);
  blockedIssue=applyInventoryMutation(b,{change_id:randomUUID(),entity_type:'item_movement',entity_id:quarantinedItem,operation:'create',payload:{id:randomUUID(),item_id:quarantinedItem,movement_type:'consume',quantity:1}},{userId:actor,role:'admin'}).then(value=>({value}),error=>({error}));
  await blocked(aPid,bPid);await a.query('COMMIT');assert.equal((await blockedIssue).error.code,'ITEM_NOT_USABLE');await b.query('ROLLBACK');
 }finally{await a.query('ROLLBACK');if(blockedIssue)await blockedIssue;await b.query('ROLLBACK');}
 assert.equal(await stock(quarantinedItem),10);assert.equal((await observer.query('SELECT 1 FROM item_movements WHERE item_id=$1',[quarantinedItem])).rowCount,0);
 console.log('PASS: a waiting stock issue rechecks the newly committed repair status and cannot consume quarantined stock.');

 const sharedItem=await item(),left=await recovery(sharedItem),right=await recovery(sharedItem);
 const both=await race(left,right);assert.equal(both.follower.ok,true);assert.equal(await stock(sharedItem),14);
 const balances=[...(await ledger(left)),...(await ledger(right))].map(r=>[Number(r.quantity_before),Number(r.quantity_after)]);assert.deepEqual(balances,[[10,12],[12,14]]);
 console.log('PASS: independent recoveries into one item preserve serialized movement balances and both credits.');

 const versionItem=await item(),versioned=await recovery(versionItem);
 const expected=Number((await observer.query('SELECT sync_version FROM item_salvage_recoveries WHERE id=$1',[versioned])).rows[0].sync_version);
 const review=await race(versioned,versioned,(client,id)=>applySalvageIntent(client,{entity_id:id,operation:'release',payload:{record:{},expected_version:expected}},{userId:actor}));
 assert.equal(review.follower.ok,false);assert.equal(review.follower.error.code,'SALVAGE_VERSION_CONFLICT');assert.equal(await stock(versionItem),12);assert.equal((await ledger(versioned)).length,1);
 console.log('PASS: independent stale reviewer is rejected after waiting for the newer committed recovery version.');

 const revokedItem=await item(),revoked=await recovery(revokedItem);let revokedPending;
 try{
  await tx(a);await tx(b);await a.query('SELECT id FROM item_salvage_recoveries WHERE id=$1 FOR UPDATE',[revoked]);
  revokedPending=releaseSalvage(b,revoked,actor).then(value=>({value}),error=>({error}));await blocked(aPid,bPid);
  await observer.query('UPDATE users SET is_active=false WHERE id=$1',[actor]);await a.query('COMMIT');
  assert.equal((await revokedPending).error.code,'ACCOUNT_DISABLED');await b.query('ROLLBACK');
 }finally{await a.query('ROLLBACK');if(revokedPending)await revokedPending;await b.query('ROLLBACK');await observer.query('UPDATE users SET is_active=true WHERE id=$1',[actor]);}
 assert.equal(await stock(revokedItem),10);assert.equal((await ledger(revoked)).length,0);
 console.log('PASS: a blocked request reloads account authority after revocation and cannot credit stock.');

 const rollbackItem=await item(),rollbackRecovery=await recovery(rollbackItem);let reached,failLedger;
 const atLedger=new Promise(resolve=>{reached=resolve;}),gate=new Promise((_,reject)=>{failLedger=reject;});let failed,waiting;
 gate.catch(()=>{});
 try{
  await tx(a);await tx(b);
  const fault={query(sql,args){if(sql.startsWith('INSERT INTO item_movements')){reached();return gate;}return a.query(sql,args);}};
  failed=releaseSalvage(fault,rollbackRecovery,actor).then(value=>({value}),error=>({error}));
  await Promise.race([atLedger,failed.then(result=>{throw result.error||Error('Ledger checkpoint was not reached');})]);
  waiting=releaseSalvage(b,rollbackRecovery,actor).then(value=>({value}),error=>({error}));await blocked(aPid,bPid);
  failLedger(Error('Injected ledger failure'));assert.match((await failed).error.message,/Injected/);await a.query('ROLLBACK');
  assert.equal((await waiting).value.quarantine_status,'released');await b.query('COMMIT');
 }finally{failLedger(Error('Fixture cleanup'));if(failed)await failed;await a.query('ROLLBACK');if(waiting)await waiting;await b.query('ROLLBACK');}
 assert.equal(await stock(rollbackItem),12);assert.equal((await ledger(rollbackRecovery)).length,1);
 console.log('PASS: failed writer rolls stock back; already waiting retry performs exactly one committed credit.');
}finally{
 await Promise.allSettled([a.query('ROLLBACK'),b.query('ROLLBACK')]);
 try{
  await observer.query('BEGIN');
  await observer.query('DELETE FROM item_salvage_recoveries WHERE id=ANY($1::uuid[]) AND quarantined_by=$2',[recoveries,actor]);
  await observer.query('DELETE FROM item_salvage_batches WHERE id=ANY($1::uuid[]) AND created_by=$2',[batches,actor]);
  await observer.query('DELETE FROM item_custody_settlements WHERE custody_id=ANY($1::uuid[])',[custodies]);
  await observer.query('DELETE FROM item_custody_records WHERE id=ANY($1::uuid[])',[custodies]);
  await observer.query('DELETE FROM audit_log WHERE actor_user_id=$1',[actor]);
  await observer.query('DELETE FROM item_movements WHERE performed_by=$1',[actor]);
  await observer.query('DELETE FROM items WHERE id=ANY($1::uuid[])',[items]);
  await observer.query('DELETE FROM users WHERE id=$1',[actor]);await observer.query('COMMIT');
  assert.equal((await observer.query('SELECT 1 FROM users WHERE id=$1',[actor])).rowCount,0);
  assert.equal((await observer.query('SELECT 1 FROM items WHERE id=ANY($1::uuid[])',[items])).rowCount,0);
  assert.equal((await observer.query('SELECT 1 FROM item_salvage_recoveries WHERE id=ANY($1::uuid[])',[recoveries])).rowCount,0);
  assert.equal((await observer.query('SELECT 1 FROM item_salvage_batches WHERE id=ANY($1::uuid[])',[batches])).rowCount,0);
  assert.equal((await observer.query('SELECT 1 FROM item_custody_records WHERE id=ANY($1::uuid[])',[custodies])).rowCount,0);
  assert.equal((await observer.query('SELECT 1 FROM item_movements WHERE performed_by=$1',[actor])).rowCount,0);
  console.log('PASS: all owned committed concurrency fixtures removed; no existing data reset.');
 }finally{observer.release();a.release();b.release();await pool.end();}
}
