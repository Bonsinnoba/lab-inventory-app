import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import express from 'express';
import jwt from 'jsonwebtoken';
import {config} from './config.js';
import {authenticateToken} from './middleware/auth.js';
import itemsRouter from './routes/items.js';
import projectsRouter from './routes/projects.js';
import syncRouter from './routes/sync.js';
import {pool} from './db.js';
import {releaseSalvage} from './salvage-release.js';
import {applyInventoryRaw} from './inventory-apply.js';
if(process.env.LABOS_DEV_SALVAGE_PROBE!=='rollback-only')throw Error('Explicit development rollback-only opt-in required');
const c=await pool.connect(),actor=randomUUID(),item=randomUUID(),recoveries=[];
let generatedItem,receiptDevice;
const originalQuery=pool.query,originalConnect=pool.connect;let server;
const outsider=randomUUID(),privateProject=randomUUID();
async function fixture(patch={}){
 const id=randomUUID();recoveries.push(id);
 await c.query(`INSERT INTO item_salvage_recoveries(id,recovered_item_id,recovery_type,recovered_item_name,source_quantity,recovered_quantity,unit,quarantine_status,condition,reviewed_valuation,quarantined_by,attestation_notes)
  VALUES($1,$2,$3,'Rollback salvage',2,2,$4,$5,$6,25,$7,'Rollback-only provenance attestation')`,
  [id,patch.destination===false?null:item,patch.type||'component_recovery',patch.unit||'each',patch.state||'inspected_approved',patch.condition||'good',actor]);return id;
}
async function rejected(id,code,actorId=actor){
 await c.query('SAVEPOINT rejection');
 try{await assert.rejects(()=>releaseSalvage(c,id,actorId),error=>error.code===code);}
 finally{await c.query('ROLLBACK TO SAVEPOINT rejection');await c.query('RELEASE SAVEPOINT rejection');}
}
try{
 await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='10s'");
 await c.query(readFileSync(new URL('./migrations/20261029_salvage_source_movement.sql',import.meta.url),'utf8'));
 await c.query(readFileSync(new URL('./migrations/20261029_salvage_source_output_batches.sql',import.meta.url),'utf8'));
 await c.query(readFileSync(new URL('./migrations/20261029_salvage_source_return_custody.sql',import.meta.url),'utf8'));
 await c.query(readFileSync(new URL('./migrations/20261101_salvage_custody_repair.sql',import.meta.url),'utf8'));
 await c.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'no-login','admin',true)",[actor,`salvage-probe-${actor}`]);
 await c.query("INSERT INTO items(id,name,type,current_quantity,initial_quantity,unit) VALUES($1,'Rollback salvage destination','component',10,10,'each')",[item]);
 const existing=await fixture();
 const released=await releaseSalvage(c,existing,actor);
 assert.equal(released.quarantine_status,'released');
 await releaseSalvage(c,existing,actor);
 let stock=(await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0];assert.equal(Number(stock.current_quantity),12);
 const movements=(await c.query('SELECT * FROM item_movements WHERE item_id=$1',[item])).rows;
 assert.equal(movements.length,1);assert.equal(Number(movements[0].quantity_before),10);assert.equal(Number(movements[0].quantity_after),12);
 assert.equal(movements[0].reference,`salvage:${existing}`);
 const fresh=await fixture({destination:false});generatedItem=(await releaseSalvage(c,fresh,actor)).recovered_item_id;
 const created=(await c.query('SELECT * FROM items WHERE id=$1',[generatedItem])).rows[0];
 assert.equal(created.type,'component');assert.equal(created.unit_cost,null);assert.equal(created.replacement_cost,null);
 assert.equal(Number((await c.query('SELECT reviewed_valuation FROM item_salvage_recoveries WHERE id=$1',[fresh])).rows[0].reviewed_valuation),25);
 const repair=await fixture({destination:false,condition:'damaged_repairable'});const repairItem=(await releaseSalvage(c,repair,actor)).recovered_item_id;
 assert.equal((await c.query('SELECT status FROM items WHERE id=$1',[repairItem])).rows[0].status,'needs_repair');
 for(const type of ['checkout','consume'])await assert.rejects(()=>applyInventoryRaw(c,{entity_type:'item_movement',entity_id:repairItem,operation:'create',payload:{id:randomUUID(),item_id:repairItem,movement_type:type,quantity:1}},actor),error=>error.code==='ITEM_NOT_USABLE');
 for(const status of ['damaged','needs_repair','needs_replacement']){await c.query('UPDATE items SET status=$1 WHERE id=$2',[status,item]);await rejected(await fixture(),'SALVAGE_DESTINATION_UNUSABLE');}
 await c.query("UPDATE items SET status='available' WHERE id=$1",[item]);
 const scrap=await fixture({type:'scrap',condition:'scrap'});
 assert.equal((await releaseSalvage(c,scrap,actor)).recovered_item_id,null);
 await rejected(await fixture({state:'quarantined'}),'QUARANTINE_NOT_APPROVED');
 await rejected(await fixture({condition:'uninspected'}),'SALVAGE_CONDITION_NOT_USABLE');
 await rejected(await fixture({condition:'damaged_repairable'}),'SALVAGE_CONDITION_MISMATCH');
 await rejected(await fixture({unit:'kg'}),'SALVAGE_UNIT_MISMATCH');
 await c.query("UPDATE items SET status='retired' WHERE id=$1",[item]);
 await rejected(await fixture(),'SALVAGE_DESTINATION_RETIRED');
 await c.query("UPDATE items SET status='available' WHERE id=$1",[item]);
 // Inject failure after stock UPDATE while all real queries still execute in PG.
 const failed=await fixture();await c.query('SAVEPOINT failed_release');
 const failing={query(sql,args){if(sql.startsWith('INSERT INTO item_movements'))throw Error('Injected ledger failure');return c.query(sql,args);}};
 await assert.rejects(()=>releaseSalvage(failing,failed,actor),/Injected ledger failure/);
 await c.query('ROLLBACK TO SAVEPOINT failed_release');await c.query('RELEASE SAVEPOINT failed_release');
 stock=(await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0];assert.equal(Number(stock.current_quantity),12);
 assert.equal((await c.query('SELECT quarantine_status FROM item_salvage_recoveries WHERE id=$1',[failed])).rows[0].quarantine_status,'inspected_approved');
 const movement=randomUUID();
 await c.query("INSERT INTO item_movements(id,item_id,movement_type,quantity,quantity_before,quantity_after,performed_by) VALUES($1,$2,'consume',4,14,10,$3)",[movement,item,actor]);
 async function linked(){const id=await fixture();await c.query('UPDATE item_salvage_recoveries SET source_movement_id=$1,source_item_id=$2 WHERE id=$3',[movement,item,id]);return id;}
 const first=await linked(),second=await linked(),excess=await linked();
 await releaseSalvage(c,first,actor);await releaseSalvage(c,second,actor);
 await rejected(excess,'SALVAGE_SOURCE_EXHAUSTED');
 await releaseSalvage(c,first,actor);
 assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),16);
 const mismatch=await linked();await c.query('UPDATE item_salvage_recoveries SET source_item_id=$1 WHERE id=$2',[generatedItem,mismatch]);
 await rejected(mismatch,'SALVAGE_SOURCE_MISMATCH');
 const unknown=await fixture();await c.query('UPDATE item_salvage_recoveries SET attestation_notes=NULL WHERE id=$1',[unknown]);
 await rejected(unknown,'SALVAGE_ATTESTATION_REQUIRED');
 const custody=randomUUID();
 await c.query('INSERT INTO item_custody_records(id,item_id,recipient_id,issued_by,initial_quantity,outstanding_quantity) VALUES($1,$2,$3,$3,1,1)',[custody,item,actor]);
 for(const status of ['needs_repair','damaged','needs_replacement','retired']){
  await c.query('SAVEPOINT unusable_stock');
  try{
   await c.query('UPDATE items SET status=$1 WHERE id=$2',[status,item]);
   for(const type of ['checkout','consume']){
    await assert.rejects(()=>applyInventoryRaw(c,{entity_type:'item_movement',entity_id:item,operation:'create',payload:{id:randomUUID(),item_id:item,movement_type:type,quantity:0.25}},actor),error=>error.code==='ITEM_NOT_USABLE');
   }
   const before=Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity);
   const settled=await applyInventoryRaw(c,{entity_type:'item_movement',entity_id:item,operation:'create',payload:{id:randomUUID(),item_id:item,custody_id:custody,movement_type:'consume',settlement_type:'damage',quantity:0.25}},actor);
   assert.equal(Number(settled.item.current_quantity),before);assert.equal(Number(settled.custody_settlement.quantity),0.25);
  }finally{await c.query('ROLLBACK TO SAVEPOINT unusable_stock');await c.query('RELEASE SAVEPOINT unusable_stock');}
 }
 console.log('PASS: unusable stock cannot be issued/consumed; existing custody can still record damage without deducting storeroom stock again.');
 const returned=await fixture({type:'equipment_return'});await c.query('UPDATE item_salvage_recoveries SET source_item_id=$1 WHERE id=$2',[item,returned]);
 await rejected(returned,'SALVAGE_CUSTODY_RETURN_REQUIRED');
 pool.query=(...args)=>c.query(...args);
 let routeActive=false,failReceipt=false,failAudit=false;
 pool.connect=async()=>({async query(sql,args){
  if(sql==='BEGIN'){assert.equal(routeActive,false);await c.query('SAVEPOINT salvage_route');routeActive=true;return;}
  if(sql==='COMMIT'){await c.query('RELEASE SAVEPOINT salvage_route');routeActive=false;return;}
  if(sql==='ROLLBACK'){if(routeActive){await c.query('ROLLBACK TO SAVEPOINT salvage_route');await c.query('RELEASE SAVEPOINT salvage_route');routeActive=false;}return;}
  if(failAudit&&sql.includes('INSERT INTO audit_log'))return c.query('SELECT 1/0');
  if(failReceipt&&sql.startsWith('INSERT INTO sync_idempotency'))throw Error('Injected salvage receipt failure');
  return c.query(sql,args);
 },release(){assert.equal(routeActive,false);}});
 const app=express();app.use(express.json());app.use('/api/items',authenticateToken,itemsRouter);
 app.use('/api/sync',authenticateToken,syncRouter);
 app.use('/api/projects',authenticateToken,projectsRouter);
 app.use((error,req,res,next)=>res.status(500).json({error:{code:'PROBE_INJECTED_FAILURE'}}));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const version=(await c.query('SELECT credential_version FROM users WHERE id=$1',[actor])).rows[0].credential_version;
 const token=jwt.sign({userId:actor,credentialVersion:version},config.jwtSecret,{expiresIn:'5m'});
 async function post(path,body,status,bearer=token,key=randomUUID()){
  body={...body};
  if(path===''||path==='/batch')body.id??=randomUUID();
  else if(body.expected_version==null){const id=path.split('/')[1];body.expected_version=Number((await c.query('SELECT sync_version FROM item_salvage_recoveries WHERE id=$1',[id])).rows[0]?.sync_version);}
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/items/salvage/recoveries${path}`,{method:'POST',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;
 }
 const input={recovery_type:'component_recovery',recovered_item_name:'HTTP probe',source_quantity:1,recovered_quantity:1,unit:'each'};
 const stableId=randomUUID(),stableKey=randomUUID(),stableBody={...input,id:stableId,attestation_notes:'Rollback-only browser recovery'};
 recoveries.push(stableId);
 const browserCreated=await post('',stableBody,201,token,stableKey);
 assert.equal((await post('',stableBody,201,token,stableKey)).id,stableId);
 assert.equal((await c.query("SELECT 1 FROM audit_log WHERE entity_type='salvage_recovery' AND entity_id=$1",[stableId])).rowCount,1);
 await post('',{...stableBody,recovered_quantity:2},409,token,stableKey);
 const reviewKey=randomUUID(),reviewBody={approval:'approved',condition:'good',expected_version:Number(browserCreated.sync_version)};
 const browserReviewed=await post(`/${stableId}/inspect`,reviewBody,200,token,reviewKey);
 await post(`/${stableId}/inspect`,reviewBody,200,token,reviewKey);
 await post(`/${stableId}/inspect`,reviewBody,409);
 const releaseKey=randomUUID(),releaseBody={expected_version:Number(browserReviewed.sync_version)};
 for(const failure of ['audit','receipt']){
  failAudit=failure==='audit';failReceipt=failure==='receipt';
  await post(`/${stableId}/release`,releaseBody,500,token,releaseKey);
  failAudit=false;failReceipt=false;
  assert.equal((await c.query('SELECT quarantine_status FROM item_salvage_recoveries WHERE id=$1',[stableId])).rows[0].quarantine_status,'inspected_approved');
  assert.equal((await c.query('SELECT 1 FROM item_movements WHERE reference=$1',[`salvage:${stableId}`])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[releaseKey])).rowCount,0);
  assert.equal((await c.query("SELECT 1 FROM audit_log WHERE entity_id=$1 AND action='salvage:release'",[stableId])).rowCount,0);
 }
 await post(`/${stableId}/release`,releaseBody,200,token,releaseKey);
 await post(`/${stableId}/release`,releaseBody,200,token,releaseKey);
 assert.equal((await c.query('SELECT 1 FROM item_movements WHERE reference=$1',[`salvage:${stableId}`])).rowCount,1);
 assert.equal((await c.query("SELECT 1 FROM audit_log WHERE entity_id=$1 AND action='salvage:release'",[stableId])).rowCount,1);
 console.log('PASS: browser stable identities, stale review rejection, single release/audit on replay, audit and receipt failure rollback.');
 const browserBatchId=randomUUID(),browserScrapId=randomUUID(),browserBatchKey=randomUUID();
 recoveries.push(browserBatchId,browserScrapId);
 const browserBatch={id:browserBatchId,source_quantity:1,attestation_notes:'Rollback-only disassembly provenance',outputs:[
  {id:browserBatchId,recovered_item_name:'Batch motor',recovered_quantity:1,unit:'each',recovery_type:'disassembly_output'},
  {id:browserScrapId,recovered_item_name:'Batch scrap',recovered_quantity:0.5,unit:'kg',recovery_type:'scrap'}]};
 for(const failure of ['audit','receipt']){
  failAudit=failure==='audit';failReceipt=failure==='receipt';
  await post('/batch',browserBatch,500,token,browserBatchKey);failAudit=false;failReceipt=false;
  assert.equal((await c.query('SELECT 1 FROM item_salvage_batches WHERE id=$1',[browserBatchId])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM item_salvage_recoveries WHERE id=ANY($1::uuid[])',[[browserBatchId,browserScrapId]])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[browserBatchKey])).rowCount,0);
 }
 const batchCreated=await post('/batch',browserBatch,201,token,browserBatchKey);
 const batchReplayed=await post('/batch',browserBatch,201,token,browserBatchKey);
 assert.equal(batchCreated.records.length,2);
 assert.deepEqual(batchReplayed.records.map(row=>row.id),browserBatch.outputs.map(row=>row.id));
 assert.equal((await c.query('SELECT 1 FROM item_salvage_batches WHERE id=$1',[browserBatchId])).rowCount,1);
 assert.equal((await c.query("SELECT 1 FROM audit_log WHERE entity_id=$1 AND action='salvage:create_batch'",[browserBatchId])).rowCount,1);
 await post('/batch',{...browserBatch,source_quantity:2},409,token,browserBatchKey);
 console.log('PASS: browser batch retry/identity parity, atomic outputs and audit/receipt failure rollback.');
 const createdHttp=await post('',{...input,source_movement_id:movement},201);recoveries.push(createdHttp.id);
 assert.equal(createdHttp.source_item_id,item);assert.equal(createdHttp.source_movement_id,movement);
 await post('',{...input,source_item_id:item},400);
 await post('',{...input,source_item_id:item,project_id:randomUUID(),attestation_notes:'Explicit historical attestation'},403);
 const inspected=await post(`/${unknown}/inspect`,{approval:'approved',condition:'good',attestation_notes:'Human-reviewed historical source'},200);
 assert.equal(inspected.attestation_notes,'Human-reviewed historical source');
 await post(`/${existing}/inspect`,{approval:'approved',condition:'good'},409);
 await post(`/${unknown}/inspect`,{approval:'approved',reviewed_valuation:'Infinity'},400);
 await c.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'no-login','researcher',true)",[outsider,`salvage-outsider-${outsider}`]);
 await c.query("INSERT INTO projects(id,name,owner_id,visibility) VALUES($1,'Private salvage probe',$2,'restricted')",[privateProject,outsider]);
 const privateMovement=randomUUID();
 await c.query("INSERT INTO item_movements(id,item_id,project_id,movement_type,quantity,quantity_before,quantity_after,performed_by) VALUES($1,$2,$3,'consume',1,2,1,$4)",[privateMovement,item,privateProject,outsider]);
 const privateRecovery=await fixture();await c.query('UPDATE item_salvage_recoveries SET project_id=$1 WHERE id=$2',[privateProject,privateRecovery]);
 const privateCustody=randomUUID();
 await c.query("INSERT INTO item_custody_records(id,item_id,project_id,recipient_id,issued_by,initial_quantity,outstanding_quantity,unit) VALUES($1,$2,$3,$4,$4,1,1,'each')",[privateCustody,item,privateProject,outsider]);
 const outsiderVersion=(await c.query('SELECT credential_version FROM users WHERE id=$1',[outsider])).rows[0].credential_version;
 const outsiderToken=jwt.sign({userId:outsider,credentialVersion:outsiderVersion},config.jwtSecret,{expiresIn:'5m'});
 async function visible(filter=''){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/items/salvage/recoveries${filter}`,{headers:{Authorization:`Bearer ${outsiderToken}`},signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);return(await response.json()).some(r=>r.id===privateRecovery);}
 async function syncVisible(){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/sync/salvage/pull`,{headers:{Authorization:`Bearer ${outsiderToken}`},signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);const body=await response.json();assert.equal(body.snapshot_complete,true);return body.records.some(r=>r.id===privateRecovery);}
 async function sourceVisible(){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/items/${item}/salvage-sources`,{headers:{Authorization:`Bearer ${outsiderToken}`},signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);return(await response.json()).some(row=>row.id===privateMovement);}
 async function custodyVisible(){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/items/${item}/salvage-custody-sources`,{headers:{Authorization:`Bearer ${outsiderToken}`},signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);const rows=await response.json();assert.ok(rows.every(row=>row.item_id===item&&Number(row.outstanding_quantity)>0&&['issued','partially_settled'].includes(row.status)));return rows.some(row=>row.id===privateCustody);}
 assert.equal(await visible(),false);
 assert.equal(await syncVisible(),false);
 assert.equal(await sourceVisible(),false);
 assert.equal(await custodyVisible(),false);
 assert.equal(await visible(`?project_id=${privateProject}&status=inspected_approved`),false);
 await rejected(privateRecovery,'PROJECT_ACCESS_DENIED',outsider);
 await c.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level) VALUES('project',$1,$2,'view')",[privateProject,outsider]);
 assert.equal(await visible(),true);
 assert.equal(await syncVisible(),true);
 assert.equal(await sourceVisible(),true);
 assert.equal(await custodyVisible(),true);
 await post(`/${privateRecovery}/inspect`,{approval:'approved',condition:'good'},403,outsiderToken);
 await c.query("UPDATE record_access_grants SET access_level='edit' WHERE entity_type='project' AND entity_id=$1 AND user_id=$2",[privateProject,outsider]);
 await post(`/${privateRecovery}/inspect`,{approval:'approved',condition:'good'},200,outsiderToken);
 await post(`/${privateRecovery}/release`,{},200,outsiderToken);
 await c.query("DELETE FROM record_access_grants WHERE entity_type='project' AND entity_id=$1 AND user_id=$2",[privateProject,outsider]);
 assert.equal(await visible(),false);
 assert.equal(await syncVisible(),false);
 assert.equal(await sourceVisible(),false);
 assert.equal(await custodyVisible(),false);
 await post(`/${privateRecovery}/release`,{},403,outsiderToken);
 await c.query("UPDATE users SET is_active=false WHERE id=$1",[outsider]);
 await rejected(privateRecovery,'ACCOUNT_DISABLED',outsider);
 console.log('PASS: restricted salvage read isolation, view-versus-edit grant enforcement, live revocation on inspection/release and disabled-account denial.');
 const device=randomUUID(),queued=randomUUID();receiptDevice=device;recoveries.push(queued);
 const make=(operation,record,expected_version)=>({change_id:randomUUID(),entity_type:'salvage_recovery',entity_id:queued,operation,payload:{record,expected_version}});
 async function push(change){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/sync/push`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({device_id:device,changes:[change]}),signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);return(await response.json()).results[0];}
 await c.query('SAVEPOINT stale_usable_intent');
 try{
  await c.query("UPDATE items SET status='needs_repair' WHERE id=$1",[item]);
  const current=(await c.query('SELECT current_quantity,sync_version FROM items WHERE id=$1',[item])).rows[0];
  const movementId=randomUUID(),blocked={change_id:randomUUID(),entity_type:'item_movement',entity_id:item,operation:'create',payload:{inventory_protocol:2,item_bases:[{id:item,version:Number(current.sync_version)}],id:movementId,item_id:item,movement_type:'consume',quantity:1}};
  assert.equal((await push(blocked)).error.code,'ITEM_NOT_USABLE');
  assert.equal((await c.query('SELECT 1 FROM item_movements WHERE id=$1',[movementId])).rowCount,0);assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[blocked.change_id])).rowCount,0);
  assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),Number(current.current_quantity));
 }finally{await c.query('ROLLBACK TO SAVEPOINT stale_usable_intent');await c.query('RELEASE SAVEPOINT stale_usable_intent');}
 console.log('PASS: repair bucket remains non-issuable and a formerly usable offline intent is denied transactionally after server status changes.');
 await c.query('SAVEPOINT blocked_fulfillment');
 try{
  const projectId=randomUUID(),reservationId=randomUUID();
  await c.query("INSERT INTO projects(id,name,owner_id,status) VALUES($1,'Stock clearance fixture',$2,'planning')",[projectId,actor]);
  await c.query("INSERT INTO project_reservations(id,project_id,item_id,requested_by,quantity,original_quantity,needed_from,status) VALUES($1,$2,$3,$4,1,1,now(),'confirmed')",[reservationId,projectId,item,actor]);
  await c.query("UPDATE items SET status='needs_repair' WHERE id=$1",[item]);
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${projectId}/reservations/${reservationId}/fulfill`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({request_id:randomUUID(),quantity:1}),signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,409);assert.equal((await response.json()).error.code,'ITEM_NOT_USABLE');
  assert.equal((await c.query('SELECT quantity FROM project_reservations WHERE id=$1',[reservationId])).rows[0].quantity,'1.000');assert.equal((await c.query('SELECT 1 FROM project_reservation_fulfillments WHERE reservation_id=$1',[reservationId])).rowCount,0);
 }finally{await c.query('ROLLBACK TO SAVEPOINT blocked_fulfillment');await c.query('RELEASE SAVEPOINT blocked_fulfillment');}
 console.log('PASS: direct HTTP reservation fulfillment cannot bypass repair status and leaves the allocation unchanged.');
 const create=make('create',{recovered_item_name:'Queued recovery',recovery_type:'component_recovery',source_quantity:1,recovered_quantity:2,attestation_notes:'Human historical attestation'},null);
 failAudit=true;assert.equal((await push(create)).status,'failed');failAudit=false;
 assert.equal((await c.query('SELECT 1 FROM item_salvage_recoveries WHERE id=$1',[queued])).rowCount,0);
 assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[create.change_id])).rowCount,0);
 assert.equal((await c.query("SELECT 1 FROM audit_log WHERE entity_type='salvage_recovery' AND entity_id=$1",[queued])).rowCount,0);
 failReceipt=true;assert.equal((await push(create)).status,'failed');failReceipt=false;
 assert.equal((await c.query('SELECT 1 FROM item_salvage_recoveries WHERE id=$1',[queued])).rowCount,0);
 const createdReceipt=await push(create);assert.equal(createdReceipt.status,'synced');assert.deepEqual(await push(create),createdReceipt);
 const altered=structuredClone(create);altered.payload.record.recovered_item_name='Different retry';assert.equal((await push(altered)).error.code,'IDEMPOTENCY_PAYLOAD_MISMATCH');
 const inspect=make('inspect',{approval:'approved',condition:'good'},1);
 assert.equal((await push(inspect)).status,'synced');assert.equal((await push(inspect)).status,'synced');
 assert.equal((await push(make('inspect',{approval:'rejected'},1))).error.code,'SALVAGE_VERSION_CONFLICT');
 const release=make('release',{},2);assert.equal((await push(release)).status,'synced');assert.equal((await push(release)).status,'synced');
 assert.equal((await c.query('SELECT 1 FROM item_movements WHERE reference=$1',[`salvage:${queued}`])).rowCount,1);
 assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE device_id=$1',[device])).rowCount,3);
 const snapshotResponse=await fetch(`http://127.0.0.1:${server.address().port}/api/sync/salvage/pull`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
 assert.equal(snapshotResponse.status,200);const pulled=await snapshotResponse.json();assert.equal(pulled.snapshot_complete,true);assert.equal(pulled.records.find(r=>r.id===queued).quarantine_status,'released');
 console.log('PASS: generic outbox create/inspect/release receipts, same-event retries, payload mismatch, version conflict, receipt-failure rollback and authorized pull.');
 const batchSource=randomUUID(),batchId=randomUUID(),boardId=randomUUID(),scrapId=randomUUID();recoveries.push(batchId,boardId,scrapId);
 await c.query("INSERT INTO item_movements(id,item_id,movement_type,quantity,quantity_before,quantity_after,performed_by) VALUES($1,$2,'consume',1,11,10,$3)",[batchSource,item,actor]);
 const batch=make('create_batch',{source_movement_id:batchSource,source_quantity:1,outputs:[
  {id:batchId,recovered_item_name:'Batch motor',recovered_quantity:2,unit:'each',recovery_type:'disassembly_output'},
  {id:boardId,recovered_item_name:'Batch board',recovered_quantity:1,unit:'each',recovery_type:'disassembly_output'},
  {id:scrapId,recovered_item_name:'Batch scrap',recovered_quantity:0.5,unit:'kg',recovery_type:'scrap'}]});batch.entity_id=batchId;
 const invalidBatch=structuredClone(batch);invalidBatch.payload.record.outputs[2].recovered_quantity=-1;
 const invalidResult=await push(invalidBatch);assert.equal(invalidResult.status,'rejected');assert.equal(invalidResult.error.code,'INVALID_QUANTITY');
 assert.equal((await c.query('SELECT 1 FROM item_salvage_recoveries WHERE id=ANY($1::uuid[])',[[batchId,boardId,scrapId]])).rowCount,0);
 failReceipt=true;assert.equal((await push(batch)).status,'failed');failReceipt=false;
 assert.equal((await c.query('SELECT 1 FROM item_salvage_batches WHERE id=$1',[batchId])).rowCount,0);
 assert.equal((await c.query('SELECT 1 FROM item_salvage_recoveries WHERE id=ANY($1::uuid[])',[[batchId,boardId,scrapId]])).rowCount,0);
 assert.equal((await push(batch)).status,'synced');assert.equal((await push(batch)).status,'synced');
 assert.equal((await c.query('SELECT 1 FROM item_salvage_batches WHERE id=$1',[batchId])).rowCount,1);
 assert.equal((await c.query('SELECT 1 FROM item_salvage_recoveries WHERE batch_id=$1',[batchId])).rowCount,3);
 const alteredBatch=structuredClone(batch);alteredBatch.payload.record.outputs[1].recovered_quantity=8;assert.equal((await push(alteredBatch)).error.code,'IDEMPOTENCY_PAYLOAD_MISMATCH');
 for(const outputId of [batchId,boardId,scrapId]){
  const state=(await c.query('SELECT sync_version FROM item_salvage_recoveries WHERE id=$1',[outputId])).rows[0];
  assert.equal((await push({...make('inspect',{approval:'approved',condition:outputId===scrapId?'scrap':'good'},Number(state.sync_version)),entity_id:outputId})).status,'synced');
  const approved=(await c.query('SELECT sync_version FROM item_salvage_recoveries WHERE id=$1',[outputId])).rows[0];
  const releaseOutput={...make('release',{},Number(approved.sync_version)),entity_id:outputId};
  assert.equal((await push(releaseOutput)).status,'synced');assert.equal((await push(releaseOutput)).status,'synced');
 }
 assert.equal((await c.query("SELECT 1 FROM item_movements WHERE reference=ANY($1::text[])",[[`salvage:${batchId}`,`salvage:${boardId}`]])).rowCount,2);
 assert.equal((await c.query('SELECT 1 FROM item_movements WHERE reference=$1',[`salvage:${scrapId}`])).rowCount,0);
 const extra=await fixture();await c.query('UPDATE item_salvage_recoveries SET source_movement_id=$1,source_item_id=$2,source_quantity=1 WHERE id=$3',[batchSource,item,extra]);
 await rejected(extra,'SALVAGE_SOURCE_EXHAUSTED');
 console.log('PASS: atomic multi-output creation/receipt rollback, stable retries, independent release, scrap without stock, one shared claim and standalone source exhaustion.');
 const returnedId=randomUUID();recoveries.push(returnedId);
 const returnIntent={...make('create',{source_custody_id:custody,source_item_id:item,recovery_type:'equipment_return',recovered_item_name:'Inspected issued return',source_quantity:1,recovered_quantity:1,unit:'each'}),entity_id:returnedId};
 // The earlier fixture deliberately left one issued unit outstanding. Creation
 // and inspection must not change stock or settle that holder.
 await c.query('UPDATE item_custody_records SET unit=$1 WHERE id=$2',['each',custody]);
 assert.equal((await push(returnIntent)).status,'synced');
 assert.equal(Number((await c.query('SELECT outstanding_quantity FROM item_custody_records WHERE id=$1',[custody])).rows[0].outstanding_quantity),1);
 const reviewReturn={...make('inspect',{approval:'approved',condition:'good'},1),entity_id:returnedId};assert.equal((await push(reviewReturn)).status,'synced');
 const returnRelease={...make('release',{},2),entity_id:returnedId};
 const beforeReturn=Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity);
 failReceipt=true;assert.equal((await push(returnRelease)).status,'failed');failReceipt=false;
 assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),beforeReturn);
 assert.equal(Number((await c.query('SELECT outstanding_quantity FROM item_custody_records WHERE id=$1',[custody])).rows[0].outstanding_quantity),1);
 assert.equal((await c.query('SELECT 1 FROM item_custody_settlements WHERE id=$1',[returnedId])).rowCount,0);
 assert.equal((await push(returnRelease)).status,'synced');assert.equal((await push(returnRelease)).status,'synced');
 assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),beforeReturn+1);
 const settled=(await c.query('SELECT * FROM item_custody_records WHERE id=$1',[custody])).rows[0];assert.equal(Number(settled.outstanding_quantity),0);assert.equal(settled.status,'settled');
 assert.equal((await c.query("SELECT 1 FROM item_movements WHERE id=$1 AND movement_type='return'",[returnedId])).rowCount,1);
 assert.equal((await c.query('SELECT custody_settlement_id FROM item_salvage_recoveries WHERE id=$1',[returnedId])).rows[0].custody_settlement_id,returnedId);
 assert.equal((await c.query('SELECT 1 FROM audit_log WHERE actor_user_id=$1 AND entity_type=$2',[actor,'item_movement'])).rowCount,1);
 const exhaustedReturn=structuredClone(returnIntent);exhaustedReturn.change_id=randomUUID();exhaustedReturn.entity_id=randomUUID();assert.equal((await push(exhaustedReturn)).error.code,'EXCESSIVE_SETTLEMENT');
 console.log('PASS: custody-linked quarantine/review leaves balances unchanged; release settles holder and credits original stock once with audit; receipt failure rolls everything back.');
 const partialCustody=randomUUID(),partialIds=[randomUUID(),randomUUID(),randomUUID()];recoveries.push(...partialIds);
 await c.query("INSERT INTO item_custody_records(id,item_id,recipient_id,issued_by,initial_quantity,outstanding_quantity,unit) VALUES($1,$2,$3,$3,2,2,'each')",[partialCustody,item,actor]);
 for(const outputId of partialIds){const event=structuredClone(returnIntent);event.change_id=randomUUID();event.entity_id=outputId;event.payload.record.source_custody_id=partialCustody;assert.equal((await push(event)).status,'synced');}
 const damagedReview={...make('inspect',{approval:'approved',condition:'damaged_repairable'},1),entity_id:partialIds[2]};assert.equal((await push(damagedReview)).status,'synced');
 // Keep the damaged proposal quarantined while the other two return claims
 // settle all custody. Its later intake must not settle a nonexistent balance.
 for(const [index,outputId] of partialIds.slice(0,2).entries()){
  assert.equal((await push({...make('inspect',{approval:'approved',condition:'good'},1),entity_id:outputId})).status,'synced');
  assert.equal((await push({...make('release',{},2),entity_id:outputId})).status,'synced');
  const state=(await c.query('SELECT outstanding_quantity,status FROM item_custody_records WHERE id=$1',[partialCustody])).rows[0];assert.equal(Number(state.outstanding_quantity),1-index);assert.equal(state.status,index===0?'partially_settled':'settled');
 }
 const serialCustody=randomUUID();await c.query("INSERT INTO item_custody_records(id,item_id,recipient_id,issued_by,initial_quantity,outstanding_quantity,unit,serial_number) VALUES($1,$2,$3,$3,1,1,'each','SALVAGE-PROBE-SERIAL')",[serialCustody,item,actor]);
 assert.equal((await push({...make('release',{},2),entity_id:partialIds[2]})).error.code,'CUSTODY_SETTLED');
 const fractional=structuredClone(returnIntent);fractional.change_id=randomUUID();fractional.entity_id=randomUUID();fractional.payload.record.source_custody_id=serialCustody;fractional.payload.record.source_quantity=0.5;fractional.payload.record.recovered_quantity=0.5;assert.equal((await push(fractional)).error.code,'EXCESSIVE_SETTLEMENT');
 console.log('PASS: partial custody returns preserve remaining balances, damaged units stay out of usable stock, and serialized returns require a whole unit.');
 const browserHeld=randomUUID(),browserReturn=randomUUID();recoveries.push(browserReturn);
 await c.query("INSERT INTO item_custody_records(id,item_id,recipient_id,issued_by,initial_quantity,outstanding_quantity,unit) VALUES($1,$2,$3,$3,2,2,'each')",[browserHeld,item,actor]);
 const stockBeforeBrowserReturn=Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity);
 const browserHeldRecovery=await post('',{id:browserReturn,source_custody_id:browserHeld,source_item_id:item,recovery_type:'equipment_return',recovered_item_name:'Browser inspected return',source_quantity:1,recovered_quantity:1,unit:'each'},201);
 assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),stockBeforeBrowserReturn);
 const browserHeldReview=await post(`/${browserReturn}/inspect`,{approval:'approved',condition:'good',expected_version:Number(browserHeldRecovery.sync_version)},200);
 const browserReturnKey=randomUUID(),browserReturnBody={expected_version:Number(browserHeldReview.sync_version)};
 for(const failure of ['audit','receipt']){
  failAudit=failure==='audit';failReceipt=failure==='receipt';await post(`/${browserReturn}/release`,browserReturnBody,500,token,browserReturnKey);failAudit=false;failReceipt=false;
  assert.equal(Number((await c.query('SELECT outstanding_quantity FROM item_custody_records WHERE id=$1',[browserHeld])).rows[0].outstanding_quantity),2);
  assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),stockBeforeBrowserReturn);
  assert.equal((await c.query('SELECT 1 FROM item_custody_settlements WHERE id=$1',[browserReturn])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[browserReturnKey])).rowCount,0);
 }
 await post(`/${browserReturn}/release`,browserReturnBody,200,token,browserReturnKey);await post(`/${browserReturn}/release`,browserReturnBody,200,token,browserReturnKey);
 assert.equal(Number((await c.query('SELECT outstanding_quantity FROM item_custody_records WHERE id=$1',[browserHeld])).rows[0].outstanding_quantity),1);
 assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),stockBeforeBrowserReturn+1);
 assert.equal((await c.query('SELECT 1 FROM item_custody_settlements WHERE id=$1',[browserReturn])).rowCount,1);
 console.log('PASS: browser custody-linked partial returns preserve stock before inspection, roll back audit/receipt failures and settle/credit once on retry.');
 const repairId=randomUUID();recoveries.push(repairId);
 const repairCreate={...make('create',{source_custody_id:serialCustody,source_item_id:item,recovery_type:'equipment_return',recovered_item_name:'Serial tool repair',source_quantity:1,recovered_quantity:1,unit:'each'}),entity_id:repairId};
 assert.equal((await push(repairCreate)).status,'synced');
 assert.equal((await push({...make('inspect',{approval:'approved',condition:'damaged_repairable'},1),entity_id:repairId})).status,'synced');
 const repairStock=Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity);
 const intake={...make('release',{},2),entity_id:repairId};
 for(const failure of ['audit','receipt']){
  failAudit=failure==='audit';failReceipt=failure==='receipt';assert.equal((await push(intake)).status,'failed');failAudit=false;failReceipt=false;
  assert.equal(Number((await c.query('SELECT outstanding_quantity FROM item_custody_records WHERE id=$1',[serialCustody])).rows[0].outstanding_quantity),1);
  assert.equal((await c.query('SELECT repair_received_at FROM item_salvage_recoveries WHERE id=$1',[repairId])).rows[0].repair_received_at,null);
  assert.equal((await c.query('SELECT 1 FROM item_custody_settlements WHERE id=$1',[repairId])).rowCount,0);
 }
 assert.equal((await push(intake)).status,'synced');assert.equal((await push(intake)).status,'synced');
 const inRepair=(await c.query('SELECT * FROM item_salvage_recoveries WHERE id=$1',[repairId])).rows[0];
 assert.equal(inRepair.quarantine_status,'quarantined');assert.ok(inRepair.repair_received_at);
 assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),repairStock);
 assert.equal((await c.query('SELECT settlement_type FROM item_custody_settlements WHERE id=$1',[repairId])).rows[0].settlement_type,'damage');
 const heldAfterDamage=(await c.query('SELECT * FROM item_custody_records WHERE id=$1',[serialCustody])).rows[0];
 assert.equal(Number(heldAfterDamage.outstanding_quantity),0);assert.equal(heldAfterDamage.serial_number,'SALVAGE-PROBE-SERIAL');
 const repairReview={...make('inspect',{approval:'approved',condition:'good'},Number(inRepair.sync_version)),entity_id:repairId};
 assert.equal((await push(repairReview)).error.code,'SALVAGE_REPAIR_NOTES_REQUIRED');
 repairReview.payload.record.repair_verification_notes='Replaced damaged connection and verified operation under load';
 assert.equal((await push(repairReview)).status,'synced');
 const repaired=(await c.query('SELECT * FROM item_salvage_recoveries WHERE id=$1',[repairId])).rows[0];
 const completeRepair={...make('release',{},Number(repaired.sync_version)),entity_id:repairId};
 for(const failure of ['audit','receipt']){
  failAudit=failure==='audit';failReceipt=failure==='receipt';assert.equal((await push(completeRepair)).status,'failed');failAudit=false;failReceipt=false;
  assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),repairStock);
  assert.equal((await c.query('SELECT repair_completed_at FROM item_salvage_recoveries WHERE id=$1',[repairId])).rows[0].repair_completed_at,null);
  assert.equal((await c.query('SELECT 1 FROM item_movements WHERE reference=$1',[`salvage-repair:${repairId}`])).rowCount,0);
 }
 assert.equal((await push(completeRepair)).status,'synced');assert.equal((await push(completeRepair)).status,'synced');
 const repairComplete=(await c.query('SELECT * FROM item_salvage_recoveries WHERE id=$1',[repairId])).rows[0];
 assert.equal(repairComplete.quarantine_status,'released');assert.ok(repairComplete.repair_completed_at);assert.equal(repairComplete.recovered_item_id,item);
 assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),repairStock+1);
 assert.equal((await c.query('SELECT 1 FROM item_custody_settlements WHERE id=$1',[repairId])).rowCount,1);
 assert.equal((await c.query('SELECT 1 FROM item_movements WHERE reference=$1',[`salvage-repair:${repairId}`])).rowCount,1);
 console.log('PASS: damaged intake settles custody into quarantine without stock credit; fresh documented repair restores original stock once; audit and receipt failures roll back both stages.');
 console.log('PASS: authenticated HTTP source derivation, attestation requirement, project access denial, legacy attestation review, released inspection guard and finite valuation validation.');
 assert.equal((await c.query("SELECT 1 FROM transactions WHERE logged_by=$1",[actor])).rowCount,0);
 console.log('PASS: existing/new stock, actual movement balances, sequential repeat release, separate valuation, scrap, quarantine/condition/unit guards and ledger-failure rollback.');
 console.log('PASS: consumption source linkage, aggregate recovery ceiling, source mismatch, explicit legacy attestation and custody-return bypass prevention.');
}finally{
 if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 pool.query=originalQuery;
 pool.connect=originalConnect;
 try{
  await c.query('ROLLBACK');
  for(const [table,ids] of [['users',[actor,outsider]],['projects',[privateProject]],['items',[item,generatedItem].filter(Boolean)],['item_salvage_recoveries',recoveries]])
   assert.equal((await c.query(`SELECT 1 FROM ${table} WHERE id=ANY($1::uuid[])`,[ids])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM item_movements WHERE performed_by=$1',[actor])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM item_movements WHERE performed_by=$1',[outsider])).rowCount,0);
  if(receiptDevice)assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE device_id=$1',[receiptDevice])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM items WHERE acquisition_notes=ANY($1::text[])',[recoveries.map(id=>`Recovery ${id}`)])).rowCount,0);
  console.log('PASS: all salvage fixtures absent after rollback.');
 }finally{c.release();await pool.end();}
}
