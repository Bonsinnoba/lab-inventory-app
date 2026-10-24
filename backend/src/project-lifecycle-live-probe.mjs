// Stream with globalThis.labosProjectLifecycleSource set to current helper source.
// Uses existing PostgreSQL, but all fixture records are rolled back.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from 'file:///app/src/db.js';
const source=globalThis.labosProjectLifecycleSource;
assert.equal(typeof source,'string');
const {assertProjectDeletable,applyProjectLifecycle,projectInventorySettlement}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const c=await pool.connect(),actor=randomUUID(),item=randomUUID(),project=randomUUID();
const results=[];
try {
  await c.query('BEGIN');
  assert.equal(typeof globalThis.labosProjectLifecycleMigration,'string');
  await c.query(globalThis.labosProjectLifecycleMigration);
  await c.query("SET LOCAL statement_timeout='10s'");
  await c.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'no-login','admin')",[actor,'lifecycle-probe-'+actor]);
  await c.query("INSERT INTO items(id,name,type,initial_quantity,current_quantity) VALUES($1,'Rollback lifecycle fixture','component',10,10)",[item]);
  await c.query("INSERT INTO projects(id,name,owner_id) VALUES($1,'Rollback lifecycle fixture',$2)",[project,actor]);
  await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[project]);
  await assertProjectDeletable(c,project);results.push('empty project allowed');
  const historyCase=async(name,seed)=>{
    await c.query('SAVEPOINT recorded_history');
    await seed();
    await assert.rejects(()=>assertProjectDeletable(c,project),e=>e.status===409&&e.code==='PROJECT_RECORDED_HISTORY_PROTECTED');
    assert.equal((await c.query('SELECT id FROM projects WHERE id=$1',[project])).rowCount,1);
    await c.query('ROLLBACK TO SAVEPOINT recorded_history');
    await c.query('RELEASE SAVEPOINT recorded_history');
    await assertProjectDeletable(c,project);
    results.push(name);
  };
  await historyCase('financial transaction preserves project attribution',()=>c.query("INSERT INTO transactions(type,amount,project_id) VALUES('project_expense',0,$1)",[project]));
  await historyCase('purchase batch preserves project attribution',()=>c.query("INSERT INTO purchase_batches(reference,project_id) VALUES('rollback-history',$1)",[project]));
  await historyCase('salvage provenance remains protected while quarantined',()=>c.query(`INSERT INTO item_salvage_recoveries(project_id,recovery_type,recovered_item_name,source_quantity,recovered_quantity,quarantined_by)
    VALUES($1,'component_recovery','rollback fixture',1,1,$2)`,[project,actor]));
  const experiment=randomUUID();
  const seedExperiment=()=>c.query("INSERT INTO project_experiments(id,project_id,title) VALUES($1,$2,'rollback experiment')",[experiment,project]);
  await historyCase('inline experiment result protected even while planned',async()=>{
    await c.query("INSERT INTO project_experiments(id,project_id,title,result) VALUES($1,$2,'rollback experiment','observed result')",[experiment,project]);
  });
  await historyCase('experiment measurements protect their originating project',async()=>{
    await seedExperiment();
    await c.query("INSERT INTO project_experiment_measurements(experiment_id,name,value_numeric) VALUES($1,'reading',0)",[experiment]);
  });
  await historyCase('experiment observations protect their originating project',async()=>{
    await seedExperiment();
    await c.query("INSERT INTO project_experiment_observations(experiment_id,content) VALUES($1,'recorded observation')",[experiment]);
  });
  await historyCase('experiment revision history survives cleared current results',async()=>{
    await seedExperiment();
    await c.query("UPDATE project_experiments SET result='recorded' WHERE id=$1",[experiment]);
    await c.query("UPDATE project_experiments SET result='' WHERE id=$1",[experiment]);
  });
  await historyCase('experiment-only findings retain provenance',async()=>{
    await seedExperiment();
    await c.query("INSERT INTO lab_findings(experiment_id,title) VALUES($1,'finding')",[experiment]);
  });
  await historyCase('experiment-only lab results retain provenance',async()=>{
    await seedExperiment();
    await c.query("INSERT INTO lab_results(experiment_id,title,value_numeric) VALUES($1,'result',0)",[experiment]);
  });
  await historyCase('experiment-only calculations retain provenance',async()=>{
    await seedExperiment();
    await c.query("INSERT INTO engineering_calculations(experiment_id,title,formula,result_numeric) VALUES($1,'calculation','0',0)",[experiment]);
  });
  await historyCase('engineering test results protected even while planned',()=>c.query(`INSERT INTO engineering_tests(project_id,title,results) VALUES($1,'test','{"reading":0}'::jsonb)`,[project]));
  const custody=randomUUID();
  await c.query(`INSERT INTO item_custody_records(id,item_id,project_id,recipient_id,issued_by,initial_quantity,outstanding_quantity)
    VALUES($1,$2,$3,$4,$4,2,2)`,[custody,item,project,actor]);
  const protectedHistory=()=>assert.rejects(()=>assertProjectDeletable(c,project),e=>e.status===409&&e.code==='PROJECT_INVENTORY_HISTORY_PROTECTED');
  await protectedHistory();results.push('outstanding custody protected');
  await c.query("UPDATE item_custody_records SET outstanding_quantity=0,status='settled' WHERE id=$1",[custody]);
  await protectedHistory();results.push('settled custody provenance protected');
  // Isolate the second independent history path within the rollback-only fixture.
  await c.query('DELETE FROM item_custody_records WHERE id=$1',[custody]);
  const reservation=randomUUID(),movement=randomUUID();
  await c.query(`INSERT INTO project_reservations(id,project_id,item_id,requested_by,quantity,original_quantity,needed_from,status)
    VALUES($1,$2,$3,$4,1,2,now(),'confirmed')`,[reservation,project,item,actor]);
  await c.query(`INSERT INTO item_movements(id,item_id,movement_type,quantity,quantity_before,quantity_after,performed_by,project_id)
    VALUES($1,$2,'consume',1,10,9,$3,$4)`,[movement,item,actor,project]);
  await protectedHistory();results.push('unreserved project movement provenance protected');
  await c.query('UPDATE item_movements SET project_id=NULL WHERE id=$1',[movement]);
  await c.query(`INSERT INTO project_reservation_fulfillments(reservation_id,movement_id,quantity,performed_by)
    VALUES($1,$2,1,$3)`,[reservation,movement,actor]);
  await protectedHistory();results.push('consumption fulfillment protected without custody');
  assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),10);
  results.push('guard never adjusts stock');
  await c.query(`INSERT INTO item_custody_records(id,item_id,project_id,recipient_id,issued_by,initial_quantity,outstanding_quantity)
    VALUES($1,$2,$3,$4,$4,2,2)`,[custody,item,project,actor]);
  const pending=randomUUID();
  await c.query(`INSERT INTO project_reservations(id,project_id,item_id,requested_by,quantity,original_quantity,needed_from,status)
    VALUES($1,$2,$3,$4,1,1,now(),'pending_review')`,[pending,project,item,actor]);
  const current=async()=>(await c.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE',[project])).rows[0];
  const before=await current();
  await assert.rejects(()=>applyProjectLifecycle(c,before,'cancelled',0),e=>e.code==='PROJECT_LIFECYCLE_CONFLICT');
  assert.equal((await c.query('SELECT status FROM project_reservations WHERE id=$1',[reservation])).rows[0].status,'confirmed');
  results.push('stale lifecycle revision rejects without releasing stock');
  await c.query('SAVEPOINT lifecycle_rollback');
  await applyProjectLifecycle(c,before,'cancelled',before.lifecycle_revision);
  await c.query("UPDATE projects SET status='cancelled' WHERE id=$1",[project]);
  await c.query('ROLLBACK TO SAVEPOINT lifecycle_rollback');await c.query('RELEASE SAVEPOINT lifecycle_rollback');
  assert.equal((await current()).status,'planning');
  assert.equal((await c.query('SELECT status FROM project_reservations WHERE id=$1',[reservation])).rows[0].status,'confirmed');
  results.push('lifecycle transaction rollback restores allocations and status');
  await applyProjectLifecycle(c,before,'cancelled',before.lifecycle_revision);
  await c.query("UPDATE projects SET status='cancelled' WHERE id=$1",[project]);
  const released=(await c.query('SELECT status,quantity,fulfilled_quantity FROM project_reservations WHERE id=$1',[reservation])).rows[0];
  assert.equal(released.status,'released');assert.equal(Number(released.quantity),1);
  assert.equal((await c.query('SELECT status FROM project_reservations WHERE id=$1',[pending])).rows[0].status,'rejected');
  assert.equal((await c.query('SELECT id FROM project_reservation_fulfillments WHERE reservation_id=$1',[reservation])).rowCount,1);
  assert.equal((await projectInventorySettlement(c,project)).state,'unsettled');
  results.push('cancellation releases unused allocation and rejects pending demand but retains custody and fulfillment');
  const cancelled=await current();assert.equal(cancelled.lifecycle_revision,before.lifecycle_revision+1);
  await applyProjectLifecycle(c,cancelled,'archived',cancelled.lifecycle_revision);
  await c.query("UPDATE projects SET status='archived' WHERE id=$1",[project]);
  assert.equal((await projectInventorySettlement(c,project)).state,'unsettled');
  results.push('archive allows outstanding custody without claiming settlement');
  const archived=await current();await applyProjectLifecycle(c,archived,'planning',archived.lifecycle_revision);
  await c.query("UPDATE projects SET status='planning' WHERE id=$1",[project]);
  assert.equal((await c.query('SELECT status FROM project_reservations WHERE id=$1',[reservation])).rows[0].status,'released');
  results.push('reopening does not recreate released allocations');
  assert.equal(Number((await c.query('SELECT outstanding_quantity FROM item_custody_records WHERE id=$1',[custody])).rows[0].outstanding_quantity),2);
  assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[item])).rows[0].current_quantity),10);
  results.push('all lifecycle transitions leave physical quantities unchanged');
} finally {
  await c.query('ROLLBACK');
  const remaining=await c.query('SELECT id FROM users WHERE id=$1 UNION ALL SELECT id FROM projects WHERE id=$2 UNION ALL SELECT id FROM items WHERE id=$3',[actor,project,item]);
  assert.equal(remaining.rowCount,0,'Fixture rollback verified');
  c.release();await pool.end();
}
console.log(JSON.stringify({passed:results.length,checks:results,rollback:true}));
