// Opt-in source-in-memory probe of the real push handler and existing PostgreSQL.
// Route transactions are nested savepoints inside ONE rollback-only transaction.
// No production API files, user stock, or permanent schema are changed.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {pool} from 'file:///app/src/db.js';

const packet=globalThis.labosCustodySyncProbe;
for(const key of ['route','sync','apply','migration']) assert.equal(typeof packet?.[key],'string',`Missing ${key}`);
const require=createRequire('/app/package.json');
const data=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const imports=(source,base,overrides={})=>source.replace(/from\s+(['"])([^'"]+)\1/g,(whole,quote,specifier)=>{
  const resolved=overrides[specifier] ?? (specifier.startsWith('.')?new URL(specifier,base).href:
    specifier==='express'?pathToFileURL(require.resolve(specifier)).href:specifier);
  return `from ${quote}${resolved}${quote}`;
});
const client=await pool.connect();
const actor=randomUUID(),recipient=randomUUID(),item=randomUUID(),device=randomUUID();
let inRouteTransaction=false,failReceipt=false;
const routeClient={
  async query(sql,values){
    if(sql==='BEGIN'){assert.equal(inRouteTransaction,false);await client.query('SAVEPOINT custody_route');inRouteTransaction=true;return;}
    if(sql==='COMMIT'){assert.equal(inRouteTransaction,true);await client.query('RELEASE SAVEPOINT custody_route');inRouteTransaction=false;return;}
    if(sql==='ROLLBACK'){
      if(inRouteTransaction){await client.query('ROLLBACK TO SAVEPOINT custody_route');await client.query('RELEASE SAVEPOINT custody_route');inRouteTransaction=false;}
      return;
    }
    if(failReceipt&&sql.startsWith('INSERT INTO sync_idempotency'))throw Object.assign(new Error('Injected receipt write failure'),{code:'PROBE_RECEIPT_FAILURE'});
    return client.query(sql,values);
  },
  release(){assert.equal(inRouteTransaction,false,'Route must finish its transaction');},
};
globalThis.labosCustodyProbePool={connect:async()=>routeClient,query:(...args)=>client.query(...args)};
const db=data('export const pool=globalThis.labosCustodyProbePool;');
// Keep the real audit implementation, but route its default connection through
// the outer rollback transaction too. Production post-commit project audit
// atomicity is NOT certified by this harness.
const auditURL=data(imports(readFileSync('/app/src/middleware/audit.js','utf8'),'file:///app/src/middleware/audit.js',{'../db.js':db}));
const applyURL=data(imports(packet.apply,'file:///app/src/inventory-apply.js'));
const syncURL=data(imports(packet.sync,'file:///app/src/inventory-sync.js',{'./inventory-apply.js':applyURL}));
const lifecycleOverride=packet.lifecycle?{'../project-lifecycle.js':data(packet.lifecycle)}:{};
const routeURL=data(imports(packet.route,'file:///app/src/routes/sync.js',{'../db.js':db,'../inventory-sync.js':syncURL,'../inventory-apply.js':applyURL,'../middleware/audit.js':auditURL,...lifecycleOverride}));
const results=[];let failures=0,checkNumber=0;
async function check(name,run,dependencies=[]){
  if(dependencies.some(index=>results[index]?.status!=='PASS')){results.push({name,status:'BLOCKED'});failures++;return;}
  const point=`custody_check_${++checkNumber}`;await client.query(`SAVEPOINT ${point}`);
  try{await run();results.push({name,status:'PASS'});}
  catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${point}`);inRouteTransaction=false;failures++;results.push({name,status:'FAIL',message:error.message.slice(0,500),code:error.code});}
  finally{failReceipt=false;await client.query(`RELEASE SAVEPOINT ${point}`);}
}
try{
  const {default:router}=await import(routeURL);
  const push=router.stack.find(layer=>layer.route?.path==='/push'&&layer.route.methods.post).route.stack[0].handle;
  async function send(changes,options={}){
    let body,status=200,routeError;
    const response={status(value){status=value;return this;},json(value){body=value;return this;}};
    await push({body:{device_id:options.device??device,changes:structuredClone(changes)},user:{userId:options.actor??actor,role:options.role??'admin'}},response,error=>{routeError=error;});
    if(routeError)throw routeError;
    assert.equal(status,200);assert.ok(body?.results);return body.results;
  }
  const movement=(payload,version=1,depends_on=null)=>({change_id:randomUUID(),entity_type:'item_movement',entity_id:item,operation:'create',payload:{id:randomUUID(),item_id:item,inventory_protocol:2,item_bases:[{id:item,version,depends_on}],...payload}});
  const ok=row=>assert.equal(row.status,'synced',JSON.stringify(row));
  const rejected=(row,code)=>{assert.equal(row.status,'rejected',JSON.stringify(row));assert.equal(row.error.code,code);};
  async function state(){
    return {
      item:(await client.query('SELECT current_quantity,sync_version FROM items WHERE id=$1',[item])).rows[0],
      movements:(await client.query('SELECT id FROM item_movements WHERE item_id=$1 ORDER BY id',[item])).rows,
      custody:(await client.query('SELECT id,outstanding_quantity,status,recipient_id FROM item_custody_records WHERE item_id=$1 ORDER BY id',[item])).rows,
      settlements:(await client.query('SELECT s.id FROM item_custody_settlements s JOIN item_custody_records c ON c.id=s.custody_id WHERE c.item_id=$1 ORDER BY s.id',[item])).rows,
      receipts:(await client.query('SELECT change_id FROM sync_idempotency WHERE device_id=$1 ORDER BY change_id',[device])).rows,
      audit:(await client.query('SELECT id FROM audit_log WHERE actor_user_id=$1 ORDER BY id',[actor])).rows,
    };
  }
  await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='2s'");await client.query("SET LOCAL statement_timeout='10s'");
  const beforeSchema=(await client.query("SELECT to_regclass('item_custody_records')::text AS name")).rows[0].name;
  const reservationConstraint=async()=>(await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=to_regclass('project_reservations') AND conname='project_reservations_quantity_check'")).rows;
  const beforeReservationConstraint=await reservationConstraint();
  const offset=packet.migration.indexOf('-- 2. Item custody records');assert.ok(offset>=0);
  await client.query(packet.migration);
  if(packet.reservationMigration)await client.query(packet.reservationMigration);
  if(packet.lifecycleMigration)await client.query(packet.lifecycleMigration);
  await client.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'probe-no-login','admin',true),($3,$4,'probe-no-login','admin',true)",[actor,'p2-custody-sync-'+actor,recipient,'p2-custody-sync-'+recipient]);
  await client.query("INSERT INTO items(id,name,type,current_quantity,initial_quantity,storage_location) VALUES($1,'Rollback-only custody sync probe','component',10,10,'Shelf A')",[item]);
  const issue=movement({movement_type:'checkout',quantity:4,recipient_id:actor});
  await check('issue receipt replay does not duplicate stock, custody, movement or audit',async()=>{
    ok((await send([issue]))[0]);const once=await state();
    assert.equal(Number(once.item.current_quantity),6);assert.equal(once.custody.length,1);assert.equal(once.audit.length,1);
    ok((await send([issue]))[0]);assert.deepEqual(await state(),once);
  });
  const returned=movement({movement_type:'return',quantity:1,custody_id:issue.payload.id},2,issue.change_id);
  const transferred=movement({movement_type:'transfer',quantity:1,custody_id:issue.payload.id,transfer_recipient_id:recipient},3,returned.change_id);
  await check('dependent return and transfer replay exactly once',async()=>{
    (await send([returned,transferred])).forEach(ok);const once=await state();
    assert.equal(Number(once.item.current_quantity),7);assert.equal(once.custody.length,2);assert.equal(once.settlements.length,2);
    assert.equal(Number(once.custody.find(row=>row.id===issue.payload.id).outstanding_quantity),2);
    (await send([issue,returned,transferred])).forEach(ok);assert.deepEqual(await state(),once);
  },[0]);
  await check('changed payload and foreign device/user cannot reuse an accepted receipt',async()=>{
    const before=await state(),changed=structuredClone(issue);changed.payload.quantity=3;
    rejected((await send([changed]))[0],'IDEMPOTENCY_PAYLOAD_MISMATCH');
    rejected((await send([issue],{device:randomUUID()}))[0],'IDEMPOTENCY_OWNERSHIP_MISMATCH');
    rejected((await send([issue],{actor:recipient}))[0],'IDEMPOTENCY_OWNERSHIP_MISMATCH');
    assert.deepEqual(await state(),before);
  },[0]);
  await check('missing predecessor and excessive settlement leave no receipt or partial changes',async()=>{
    const before=await state();
    rejected((await send([movement({movement_type:'return',quantity:1,custody_id:issue.payload.id},4,randomUUID())]))[0],'SYNC_DEPENDENCY_PENDING');
    rejected((await send([movement({movement_type:'return',quantity:3,custody_id:issue.payload.id},4,transferred.change_id)]))[0],'EXCESSIVE_SETTLEMENT');
    assert.deepEqual(await state(),before);
  },[1]);
  await check('receipt-write failure rolls back stock, custody, movement and audit; identical retry succeeds',async()=>{
    const request=movement({movement_type:'checkout',quantity:1,recipient_id:actor},4,transferred.change_id),before=await state();
    failReceipt=true;const failure=(await send([request]))[0];assert.equal(failure.status,'failed');assert.equal(failure.error.code,'PROBE_RECEIPT_FAILURE');
    assert.deepEqual(await state(),before);failReceipt=false;
    ok((await send([request]))[0]);const once=await state();assert.equal(Number(once.item.current_quantity),6);
    ok((await send([request]))[0]);assert.deepEqual(await state(),once);
  },[1]);
  // Project relationship checks share the same rollback-only database boundary.
  const project=randomUUID(),otherProject=randomUUID(),requirement=randomUUID(),foreignRequirement=randomUUID();
  const projectChange=(entity_type,operation,payload)=>({change_id:randomUUID(),entity_type,entity_id:payload.id,operation,payload});
  await client.query("INSERT INTO projects(id,name,status,owner_id) VALUES($1,'Rollback relationship A','planning',$3),($2,'Rollback relationship B','planning',$3)",[project,otherProject,actor]);
  await client.query("INSERT INTO project_resource_requirements(id,project_id,name,quantity) VALUES($1,$2,'Shared demand',3),($3,$4,'Foreign demand',2)",[requirement,project,foreignRequirement,otherProject]);
  const records=[['project_task','project_tasks',{title:'Shared task'}],['project_experiment','project_experiments',{title:'Shared experiment'}],['project_bom','project_bom_items',{name:'Shared BOM',required_quantity:3}]];
  await check('task, experiment and BOM share one canonical requirement; exact retries survive UUID normalization',async()=>{
    for(const [type,table,fields] of records){
      const record={id:randomUUID(),project_id:project,requirement_id:requirement.replaceAll('-','').toUpperCase(),...fields};
      const request=projectChange(type,'create',record);
      ok((await send([request]))[0]);ok((await send([request]))[0]);
      const row=(await client.query(`SELECT requirement_id FROM ${table} WHERE id=$1`,[record.id])).rows[0];
      assert.equal(row.requirement_id,requirement);
      const bad=projectChange(type,'update',{...record,requirement_id:foreignRequirement});
      rejected((await send([bad]))[0],'INVALID_PROJECT_REQUIREMENT');
      assert.equal((await client.query(`SELECT requirement_id FROM ${table} WHERE id=$1`,[record.id])).rows[0].requirement_id,requirement);
      const spoof=projectChange(type,'update',{...record,project_id:otherProject});
      rejected((await send([spoof]))[0],'INVALID_PROJECT_REFERENCE');
      const remove=projectChange(type,'delete',{id:record.id,project_id:otherProject});
      rejected((await send([remove]))[0],'INVALID_PROJECT_REFERENCE');
      ok((await send([projectChange(type,'update',{id:record.id,requirement_id:null})]))[0]);
      ok((await send([projectChange(type,'delete',{id:record.id})]))[0]);
    }
    assert.equal((await client.query('SELECT count(*)::int AS n FROM project_resource_requirements WHERE project_id=$1',[project])).rows[0].n,1);
  });
  await check('foreign link IDs cannot delete a task-experiment relationship or create a tombstone',async()=>{
    const task=randomUUID(),experiment=randomUUID(),foreignTask=randomUUID(),foreignExperiment=randomUUID(),link=randomUUID();
    await client.query("INSERT INTO project_tasks(id,project_id,title) VALUES($1,$2,'Local task'),($3,$4,'Foreign task')",[task,project,foreignTask,otherProject]);
    await client.query("INSERT INTO project_experiments(id,project_id,title) VALUES($1,$2,'Local experiment'),($3,$4,'Foreign experiment')",[experiment,project,foreignExperiment,otherProject]);
    await client.query("INSERT INTO project_task_experiments(id,project_id,task_id,experiment_id,relationship) VALUES($1,$2,$3,$4,'related')",[link,otherProject,foreignTask,foreignExperiment]);
    rejected((await send([projectChange('project_task_experiment','delete',{id:link,project_id:project,task_id:task,experiment_id:experiment})]))[0],'PROJECT_LINK_NOT_FOUND');
    assert.equal((await client.query('SELECT id FROM project_task_experiments WHERE id=$1',[link])).rowCount,1);
    assert.equal((await client.query('SELECT entity_id FROM sync_tombstones WHERE entity_id=$1',[link])).rowCount,0);
  });
  await check('canvas edits cannot connect blocks from different projects',async()=>{
    const a=randomUUID(),b=randomUUID(),foreign=randomUUID(),connector=randomUUID();
    await client.query("INSERT INTO project_blocks(id,project_id,block_type,text_content) VALUES($1,$4,'text','A'),($2,$4,'text','B'),($3,$5,'text','Foreign')",[a,b,foreign,project,otherProject]);
    ok((await send([projectChange('project_connector','create',{id:connector,project_id:project,source_block_id:a,target_block_id:b})]))[0]);
    ok((await send([projectChange('project_connector','update',{id:connector,label:'Same-project update'})]))[0]);
    rejected((await send([projectChange('project_connector','update',{id:connector,target_block_id:foreign})]))[0],'INVALID_PROJECT_CONNECTOR');
    assert.equal((await client.query('SELECT target_block_id FROM project_connectors WHERE id=$1',[connector])).rows[0].target_block_id,b);
    rejected((await send([projectChange('project_connector','create',{id:randomUUID(),project_id:project,source_block_id:a,target_block_id:foreign})]))[0],'INVALID_PROJECT_CONNECTOR');
  });
  const reservedItem=randomUUID(),allocation=randomUUID(),otherAllocation=randomUUID();
  await client.query("INSERT INTO items(id,name,type,current_quantity,initial_quantity) VALUES($1,'Rollback reservation stock','equipment',10,10)",[reservedItem]);
  await client.query(`INSERT INTO project_reservations(id,project_id,item_id,requested_by,quantity,original_quantity,needed_from,status)
    VALUES($1,$3,$5,$6,6,6,now(),'confirmed'),($2,$4,$5,$6,4,4,now(),'confirmed')`,
    [allocation,otherAllocation,project,otherProject,reservedItem,actor]);
  const reservedMove=extra=>({change_id:randomUUID(),entity_type:'item_movement',entity_id:reservedItem,operation:'create',
    payload:{id:randomUUID(),item_id:reservedItem,inventory_protocol:2,item_bases:[{id:reservedItem,version:1}],
      movement_type:'checkout',quantity:2,recipient_id:actor,project_id:project,reservation_id:allocation,...extra}});
  const allocationState=async()=>({
    item:(await client.query('SELECT current_quantity,sync_version FROM items WHERE id=$1',[reservedItem])).rows[0],
    reservations:(await client.query('SELECT id,quantity,original_quantity,fulfilled_quantity,status FROM project_reservations WHERE item_id=$1 ORDER BY id',[reservedItem])).rows,
    fulfillments:(await client.query('SELECT f.* FROM project_reservation_fulfillments f JOIN project_reservations r ON r.id=f.reservation_id WHERE r.item_id=$1 ORDER BY f.id',[reservedItem])).rows,
    custody:(await client.query('SELECT id,outstanding_quantity FROM item_custody_records WHERE item_id=$1 ORDER BY id',[reservedItem])).rows,
    movements:(await client.query('SELECT id FROM item_movements WHERE item_id=$1 ORDER BY id',[reservedItem])).rows,
    receipts:(await client.query('SELECT change_id FROM sync_idempotency WHERE device_id=$1 ORDER BY change_id',[device])).rows,
    audit:(await client.query('SELECT id FROM audit_log WHERE actor_user_id=$1 ORDER BY id',[actor])).rows,
  });
  const partialIssue=reservedMove({});
  const reservationStart=results.length;
  await check('reserved issue fulfills only its matching allocation; immutable retry does not duplicate history',async()=>{
    ok((await send([partialIssue]))[0]);const once=await allocationState();
    assert.equal(Number(once.item.current_quantity),8);
    assert.equal(Number(once.reservations.find(r=>r.id===allocation).quantity),4);
    assert.equal(Number(once.reservations.find(r=>r.id===otherAllocation).quantity),4);
    assert.equal(once.fulfillments.length,1);assert.equal(once.fulfillments[0].movement_id,partialIssue.payload.id);
    ok((await send([partialIssue]))[0]);assert.deepEqual(await allocationState(),once);
  });
  await check('invalid scope, missing recipient, excess allocation and ordinary checkout cannot consume reservations',async()=>{
    const before=await allocationState();
    for(const [payload,code] of [
      [{quantity:5},'RESERVATION_QUANTITY_CONFLICT'],
      [{project_id:otherProject},'RESERVATION_PROJECT_MISMATCH'],
      [{recipient_id:null},'RESERVATION_CUSTODY_REQUIRED'],
      [{reservation_id:null,quantity:1},'RESERVED_STOCK_CONFLICT'],
      [{requirement_id:foreignRequirement},'CUSTODY_REQUIREMENT_MISMATCH'],
    ])rejected((await send([reservedMove(payload)]))[0],code);
    await client.query("UPDATE projects SET status='cancelled' WHERE id=$1",[project]);
    rejected((await send([reservedMove({})]))[0],'RESERVATION_PROJECT_CLOSED');
    await client.query("UPDATE projects SET status='planning' WHERE id=$1",[project]);
    assert.deepEqual(await allocationState(),before);
  },[reservationStart]);
  await check('reservation decrement and fulfillment history roll back if receipt insertion fails',async()=>{
    const before=await allocationState();failReceipt=true;
    const result=(await send([reservedMove({})]))[0];
    assert.equal(result.status,'failed');assert.equal(result.error.code,'PROBE_RECEIPT_FAILURE');
    failReceipt=false;assert.deepEqual(await allocationState(),before);
  },[reservationStart]);
  await check('reservation issue rechecks active account and project editing authority',async()=>{
    const before=await allocationState();
    await client.query("UPDATE users SET role='viewer' WHERE id=$1",[actor]);
    rejected((await send([reservedMove({})]))[0],'RESERVATION_PROJECT_ACCESS_DENIED');
    await client.query("UPDATE users SET role='admin',is_active=false WHERE id=$1",[actor]);
    rejected((await send([reservedMove({})]))[0],'RESERVATION_PROJECT_ACCESS_DENIED');
    await client.query("UPDATE users SET is_active=true WHERE id=$1",[actor]);
    assert.deepEqual(await allocationState(),before);
  },[reservationStart]);
  await check('final reserved issue reaches zero; return preserves project history without reopening allocation',async()=>{
    const finalIssue=reservedMove({quantity:4});ok((await send([finalIssue]))[0]);
    const full=await allocationState(),own=full.reservations.find(r=>r.id===allocation);
    assert.equal(Number(full.item.current_quantity),4);assert.equal(Number(own.quantity),0);
    assert.equal(Number(own.original_quantity),6);assert.equal(Number(own.fulfilled_quantity),6);assert.equal(own.status,'fulfilled');
    const returned=reservedMove({custody_id:partialIssue.payload.id,movement_type:'return',quantity:1,project_id:otherProject});
    ok((await send([returned]))[0]);
    assert.equal((await client.query('SELECT project_id FROM item_movements WHERE id=$1',[returned.payload.id])).rows[0].project_id,project);
    const once=await allocationState();assert.equal(Number(once.item.current_quantity),5);
    assert.deepEqual(once.reservations,full.reservations);
    ok((await send([returned]))[0]);assert.deepEqual(await allocationState(),once);
  },[reservationStart]);
  await check('project pull includes coherent reservation quantities and fulfillment movement identities',async()=>{
    const pull=router.stack.find(layer=>layer.route?.path==='/projects/pull'&&layer.route.methods.get).route.stack[0].handle;
    let body,routeError,status=200;
    const response={setHeader(){},status(value){status=value;return this;},json(value){body=value;return this;}};
    await pull({user:{userId:actor,role:'admin'},query:{}},response,error=>{routeError=error;});
    if(routeError)throw routeError;
    assert.equal(status,200);
    const snapshot=body.projects.find(p=>p.id===project);
    assert.ok(snapshot,'Authorized fixture project is included');
    const reservation=snapshot.reservations.find(r=>r.id===allocation);
    const authoritative=(await client.query('SELECT quantity,fulfilled_quantity FROM project_reservations WHERE id=$1',[allocation])).rows[0];
    const included=(await client.query('SELECT movement_id FROM project_reservation_fulfillments WHERE reservation_id=$1 ORDER BY movement_id',[allocation])).rows.map(r=>r.movement_id);
    assert.equal(Number(reservation.quantity),Number(authoritative.quantity));
    assert.equal(Number(reservation.fulfilled_quantity),Number(authoritative.fulfilled_quantity));
    assert.deepEqual(reservation.fulfillment_movement_ids,included);
    assert.ok(reservation.fulfillment_movement_ids.includes(partialIssue.payload.id));
    assert.ok(snapshot.reservations.every(r=>r.project_id===project));
  },[reservationStart]);
  const requestId=randomUUID(),requestStock=randomUUID();
  await client.query("INSERT INTO items(id,name,type,current_quantity,initial_quantity,status) VALUES($1,'Rollback reservation requests','component',5,5,'available')",[requestStock]);
  const requestIntent={change_id:randomUUID(),entity_type:'project_reservation',entity_id:requestId,operation:'request',payload:{id:requestId,project_id:project,item_id:requestStock,quantity:3,needed_from:'2026-10-20T00:00:00Z',note:'Probe request'}};
  const decisionIntent=(decision,extra={})=>({change_id:randomUUID(),entity_type:'project_reservation',entity_id:requestId,operation:'decision',payload:{project_id:project,decision,review_note:'Probe decision',...extra}});
  const requestState=async()=>({
    rows:(await client.query('SELECT * FROM project_reservations WHERE item_id=$1 ORDER BY id',[requestStock])).rows,
    stock:(await client.query('SELECT current_quantity FROM items WHERE id=$1',[requestStock])).rows,
    audits:(await client.query("SELECT id FROM audit_log WHERE entity_type='project_reservation' AND entity_id=$1 ORDER BY id",[requestId])).rows,
    receipts:(await client.query('SELECT change_id FROM sync_idempotency WHERE entity_type=\'project_reservation\' AND device_id=$1 ORDER BY change_id',[device])).rows
  });
  const requestStart=results.length;
  await check('reservation request retry preserves one identity, audit and unchanged stock',async()=>{
    ok((await send([requestIntent]))[0]);const once=await requestState();
    assert.equal(once.rows.length,1);assert.equal(once.rows[0].status,'pending_review');assert.equal(once.audits.length,1);assert.equal(Number(once.stock[0].current_quantity),5);
    ok((await send([requestIntent]))[0]);assert.deepEqual(await requestState(),once);
    rejected((await send([{...requestIntent,change_id:randomUUID()}]))[0],'RESERVATION_ID_COLLISION');
  });
  await check('reservation decision receipt failure rolls back allocation and audit',async()=>{
    const before=await requestState();failReceipt=true;
    assert.equal((await send([decisionIntent('confirm')]))[0].status,'failed');failReceipt=false;
    assert.deepEqual(await requestState(),before);
  },[requestStart]);
  await check('confirmation and release retry once without creating physical stock movements',async()=>{
    const confirm=decisionIntent('confirm');ok((await send([confirm]))[0]);const once=await requestState();
    assert.equal(once.rows[0].status,'confirmed');assert.equal(once.audits.length,2);
    ok((await send([confirm]))[0]);assert.deepEqual(await requestState(),once);
    const release=decisionIntent('release');ok((await send([release]))[0]);const released=await requestState();
    assert.equal(released.rows[0].status,'released');assert.equal(Number(released.stock[0].current_quantity),5);
    ok((await send([release]))[0]);assert.deepEqual(await requestState(),released);
    assert.equal((await client.query('SELECT id FROM item_movements WHERE item_id=$1',[requestStock])).rowCount,0);
  },[requestStart]);
  await check('reservation intents reject foreign scope, inactive authority, invalid dates and quantities',async()=>{
    const before=await requestState();
    rejected((await send([decisionIntent('confirm',{project_id:otherProject})]))[0],'RESERVATION_NOT_FOUND');
    for(const patch of [{quantity:0.0001},{needed_until:'2026-10-19T00:00:00Z'},{needed_from:'invalid'}]){
      const rid=randomUUID();rejected((await send([{...requestIntent,change_id:randomUUID(),entity_id:rid,payload:{...requestIntent.payload,id:rid,...patch}}]))[0],'RESERVATION_INPUT_INVALID');
    }
    await client.query('UPDATE users SET is_active=false WHERE id=$1',[actor]);
    rejected((await send([decisionIntent('confirm')]))[0],'RESERVATION_AUTHORITY_DENIED');
    await client.query('UPDATE users SET is_active=true WHERE id=$1',[actor]);
    assert.deepEqual(await requestState(),before);
  },[requestStart]);
  await check('competing confirmed requests cannot allocate the same stock twice',async()=>{
    for(let index=0;index<2;index++){
      const rid=randomUUID();ok((await send([{...requestIntent,change_id:randomUUID(),entity_id:rid,payload:{...requestIntent.payload,id:rid}}]))[0]);
      const decision={...decisionIntent('confirm'),entity_id:rid};
      const result=(await send([decision]))[0];if(index===0)ok(result);else rejected(result,'RESERVATION_CONFLICT');
    }
    assert.equal(Number((await client.query("SELECT SUM(quantity) AS n FROM project_reservations WHERE item_id=$1 AND status='confirmed'",[requestStock])).rows[0].n),3);
  },[requestStart]);
  await check('non-admin review and closed-project requests are rejected using current database authority',async()=>{
    await client.query("UPDATE users SET role='member' WHERE id=$1",[actor]);
    rejected((await send([decisionIntent('confirm')]))[0],'RESERVATION_AUTHORITY_DENIED');
    await client.query("UPDATE users SET role='admin' WHERE id=$1",[actor]);
    await client.query("UPDATE projects SET status='completed' WHERE id=$1",[project]);
    const rid=randomUUID();
    rejected((await send([{...requestIntent,change_id:randomUUID(),entity_id:rid,payload:{...requestIntent.payload,id:rid}}]))[0],'RESERVATION_PROJECT_CLOSED');
    await client.query("UPDATE projects SET status='planning' WHERE id=$1",[project]);
  },[requestStart]);
  const consumable=randomUUID(),consumeAllocation=randomUUID(),protectedAllocation=randomUUID();
  await client.query("INSERT INTO items(id,name,type,current_quantity,initial_quantity) VALUES($1,'Rollback consumable','component',10,10)",[consumable]);
  await client.query(`INSERT INTO project_reservations(id,project_id,item_id,requested_by,quantity,original_quantity,needed_from,status)
    VALUES($1,$3,$5,$6,6,6,now(),'confirmed'),($2,$4,$5,$6,4,4,now(),'confirmed')`,[consumeAllocation,protectedAllocation,project,otherProject,consumable,actor]);
  const consumeMove=async(extra={})=>({change_id:randomUUID(),entity_type:'item_movement',entity_id:consumable,operation:'create',payload:{id:randomUUID(),item_id:consumable,inventory_protocol:2,item_bases:[{id:consumable,version:Number((await client.query('SELECT sync_version FROM items WHERE id=$1',[consumable])).rows[0].sync_version)}],movement_type:'consume',quantity:2,project_id:project,reservation_id:consumeAllocation,...extra}});
  const consumeState=async()=>({
    item:(await client.query('SELECT current_quantity,sync_version FROM items WHERE id=$1',[consumable])).rows,
    allocations:(await client.query('SELECT id,quantity,fulfilled_quantity,status FROM project_reservations WHERE item_id=$1 ORDER BY id',[consumable])).rows,
    movements:(await client.query('SELECT id,quantity FROM item_movements WHERE item_id=$1 ORDER BY id',[consumable])).rows,
    history:(await client.query('SELECT movement_id,quantity FROM project_reservation_fulfillments WHERE reservation_id=$1 ORDER BY movement_id',[consumeAllocation])).rows
  });
  await check('reserved consumption atomically decrements stock and allocation without custody; retry is immutable',async()=>{
    const intent=await consumeMove();ok((await send([intent]))[0]);const once=await consumeState();
    assert.equal(Number(once.item[0].current_quantity),8);assert.equal(Number(once.allocations.find(r=>r.id===consumeAllocation).quantity),4);
    assert.equal(Number(once.allocations.find(r=>r.id===protectedAllocation).quantity),4);assert.equal(once.history.length,1);
    assert.equal((await client.query('SELECT id FROM item_custody_records WHERE item_id=$1',[consumable])).rowCount,0);
    ok((await send([intent]))[0]);assert.deepEqual(await consumeState(),once);
  });
  await check('reserved consumption receipt failure rolls back stock allocation and history',async()=>{
    const before=await consumeState(),intent=await consumeMove();failReceipt=true;
    try{assert.equal((await send([intent]))[0].status,'failed');}finally{failReceipt=false;}
    assert.deepEqual(await consumeState(),before);
  });
  await check('reserved consumption rejects excess quantity and returnable equipment',async()=>{
    const before=await consumeState();
    rejected((await send([await consumeMove({quantity:7})]))[0],'RESERVATION_QUANTITY_CONFLICT');
    await client.query('SAVEPOINT returnable_fixture');
    await client.query("UPDATE items SET type='equipment' WHERE id=$1",[consumable]);
    rejected((await send([await consumeMove()]))[0],'RESERVATION_RETURNABLE_ITEM');
    await client.query('ROLLBACK TO SAVEPOINT returnable_fixture');
    await client.query('RELEASE SAVEPOINT returnable_fixture');
    assert.deepEqual(await consumeState(),before);
  });
  await check('project pull identifies reserved consumption exactly once for native reconciliation',async()=>{
    const pull=router.stack.find(layer=>layer.route?.path==='/projects/pull'&&layer.route.methods.get).route.stack[0].handle;
    let body,status=200,routeError;
    const response={setHeader(){},status(value){status=value;return this;},json(value){body=value;return this;}};
    await pull({user:{userId:actor,role:'admin'},query:{}},response,error=>{routeError=error;});if(routeError)throw routeError;
    assert.equal(status,200);
    const row=body.projects.find(p=>p.id===project).reservations.find(r=>r.id===consumeAllocation);
    const actual=await consumeState();
    assert.equal(Number(row.quantity),Number(actual.allocations.find(r=>r.id===consumeAllocation).quantity));
    assert.deepEqual(row.fulfillment_movement_ids,actual.history.map(r=>r.movement_id).sort());
    assert.equal(row.fulfillment_movement_ids.length,1);
    const requested=body.projects.find(p=>p.id===project).reservations.find(r=>r.id===requestId);
    assert.ok(requested.applied_intent_ids.includes(requestIntent.change_id));
  });
  await check('project deletion via sync preserves inventory history and creates no success receipt',async()=>{
    const before=await consumeState();
    const change=randomUUID();
    rejected((await send([{change_id:change,entity_type:'project',entity_id:project,operation:'delete',payload:{project:{id:project}}}]))[0],'PROJECT_INVENTORY_HISTORY_PROTECTED');
    assert.deepEqual(await consumeState(),before);
    assert.equal((await client.query('SELECT id FROM projects WHERE id=$1',[project])).rowCount,1);
    assert.equal((await client.query('SELECT change_id FROM sync_idempotency WHERE change_id=$1',[change])).rowCount,0);
    assert.equal((await client.query("SELECT entity_id FROM sync_tombstones WHERE entity_type='project' AND entity_id=$1",[project])).rowCount,0);
  });
  await check('sync deletion preserves financial provenance without receipt or tombstone',async()=>{
    const historyProject=randomUUID(),transaction=randomUUID(),change=randomUUID();
    await client.query("INSERT INTO projects(id,name,owner_id) VALUES($1,'Rollback financial history',$2)",[historyProject,actor]);
    await client.query("INSERT INTO transactions(id,type,amount,project_id) VALUES($1,'project_expense',1,$2)",[transaction,historyProject]);
    rejected((await send([{change_id:change,entity_type:'project',entity_id:historyProject,operation:'delete',payload:{project:{id:historyProject}}}]))[0],'PROJECT_RECORDED_HISTORY_PROTECTED');
    assert.equal((await client.query('SELECT project_id FROM transactions WHERE id=$1',[transaction])).rows[0].project_id,historyProject);
    assert.equal((await client.query('SELECT change_id FROM sync_idempotency WHERE change_id=$1',[change])).rowCount,0);
    assert.equal((await client.query("SELECT entity_id FROM sync_tombstones WHERE entity_type='project' AND entity_id=$1",[historyProject])).rowCount,0);
  });
  if(packet.projects)await check('browser deletion preserves experiment evidence without tombstones',async()=>{
    const historyProject=randomUUID(),experiment=randomUUID(),measurement=randomUUID();
    await client.query("INSERT INTO projects(id,name,owner_id) VALUES($1,'Rollback scientific history',$2)",[historyProject,actor]);
    await client.query("INSERT INTO project_experiments(id,project_id,title) VALUES($1,$2,'recorded experiment')",[experiment,historyProject]);
    await client.query("INSERT INTO project_experiment_measurements(id,experiment_id,name,value_numeric) VALUES($1,$2,'reading',0)",[measurement,experiment]);
    const url=data(imports(packet.projects,'file:///app/src/routes/projects.js',{'../db.js':db,'../middleware/audit.js':auditURL,...lifecycleOverride}));
    const {default:browser}=await import(url);
    const handler=browser.stack.find(layer=>layer.route?.path==='/:id'&&layer.route.methods.delete).route.stack.at(-1).handle;
    let body,status=200;
    const response={status(n){status=n;return this;},json(v){body=v;return this;},send(){return this;}};
    const originalError=console.error;
    // Expected route rejection otherwise prints the entire data-URL module stack.
    console.error=(...args)=>{
      if(args[0]?.code==='PROJECT_RECORDED_HISTORY_PROTECTED') return;
      originalError(...args);
    };
    try { await handler({params:{id:historyProject},user:{userId:actor,role:'admin'}},response); }
    finally { console.error=originalError; }
    assert.equal(status,409);assert.equal(body.error.code,'PROJECT_RECORDED_HISTORY_PROTECTED');
    assert.equal((await client.query('SELECT id FROM project_experiment_measurements WHERE id=$1',[measurement])).rowCount,1);
    assert.equal((await client.query('SELECT entity_id FROM sync_tombstones WHERE project_id=$1',[historyProject])).rowCount,0);
  });
  await check('lifecycle receipt failure rolls back status release and revision; replay releases once',async()=>{
    const before=(await client.query('SELECT * FROM projects WHERE id=$1',[project])).rows[0];
    const allocations=async()=>(await client.query('SELECT id,status,quantity FROM project_reservations WHERE project_id=$1 ORDER BY id',[project])).rows;
    const original=await allocations();
    const change={change_id:randomUUID(),entity_type:'project',entity_id:project,operation:'update',payload:{before,project:{id:project,status:'cancelled'}}};
    failReceipt=true;try{assert.equal((await send([change]))[0].status,'failed');}finally{failReceipt=false;}
    assert.deepEqual(await allocations(),original);
    assert.equal((await client.query('SELECT lifecycle_revision FROM projects WHERE id=$1',[project])).rows[0].lifecycle_revision,before.lifecycle_revision);
    ok((await send([change]))[0]);const once=await allocations();
    assert.ok(once.every(r=>!['confirmed','pending_review'].includes(r.status)));
    ok((await send([change]))[0]);assert.deepEqual(await allocations(),once);
    assert.equal((await client.query('SELECT lifecycle_revision FROM projects WHERE id=$1',[project])).rows[0].lifecycle_revision,before.lifecycle_revision+1);
    rejected((await send([{...change,change_id:randomUUID(),payload:{before,project:{id:project,status:'planning'}}}]))[0],'PROJECT_LIFECYCLE_CONFLICT');
  });
  if(packet.projects)await check('browser project update archives without claiming outstanding custody is settled',async()=>{
    const url=data(imports(packet.projects,'file:///app/src/routes/projects.js',{'../db.js':db,'../middleware/audit.js':auditURL,...lifecycleOverride}));
    const {default:browser}=await import(url);
    const route=browser.stack.find(layer=>layer.route?.path==='/:id'&&layer.route.methods.put).route;
    const handler=route.stack.at(-1).handle;
    const before=(await client.query('SELECT * FROM projects WHERE id=$1',[project])).rows[0];
    let body,status=200;
    const response={status(n){status=n;return this;},json(v){body=v;return this;}};
    await handler({params:{id:project},body:{status:'archived',expected_lifecycle_revision:before.lifecycle_revision},user:{userId:actor,role:'admin'},permissions:new Set(['projects.edit','inventory.view'])},response);
    assert.equal(status,200,JSON.stringify(body));assert.equal(body.status,'archived');
    const remaining=(await client.query('SELECT count(*)::integer AS n FROM item_custody_records WHERE project_id=$1 AND outstanding_quantity>0',[project])).rows[0].n;
    assert.equal(body.inventory_settlement.outstanding_custody_records,remaining);
    assert.equal(body.inventory_settlement.state,remaining?'unsettled':'settled');
    assert.equal((await client.query('SELECT lifecycle_revision FROM projects WHERE id=$1',[project])).rows[0].lifecycle_revision,before.lifecycle_revision+1);
  });
  await client.query('ROLLBACK');
  assert.equal((await client.query('SELECT id FROM items WHERE id=$1',[consumable])).rowCount,0);
  assert.equal((await client.query('SELECT id FROM items WHERE id=$1',[requestStock])).rowCount,0);
  assert.equal((await client.query('SELECT id FROM items WHERE id=$1',[item])).rowCount,0);
  assert.equal((await client.query('SELECT id FROM items WHERE id=$1',[reservedItem])).rowCount,0);
  assert.equal((await client.query('SELECT id FROM users WHERE id=ANY($1::uuid[])',[[actor,recipient]])).rowCount,0);
  assert.equal((await client.query('SELECT change_id FROM sync_idempotency WHERE device_id=$1',[device])).rowCount,0);
  assert.equal((await client.query("SELECT to_regclass('item_custody_records')::text AS name")).rows[0].name,beforeSchema);
  assert.deepEqual(await reservationConstraint(),beforeReservationConstraint);
  console.log(JSON.stringify({database:'existing PostgreSQL',boundary:'real push handler; transport/authentication middleware not exercised; nested savepoints',rollback_verified:true,passed:results.filter(r=>r.status==='PASS').length,failed:failures,results}));
}finally{await client.query('ROLLBACK').catch(()=>{});client.release();await pool.end();delete globalThis.labosCustodyProbePool;}
if(failures)process.exitCode=1;
