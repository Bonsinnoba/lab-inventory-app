// Explicitly target development PostgreSQL. Optional fixtures always roll back.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {readExperimentHistorySnapshot} from './project-experiment-history.js';

if(process.env.LABOS_DEV_HISTORY_PROBE!=='1')throw Error('Explicit development history probe opt-in required');
const client=await pool.connect();
const fixtureIds=[];
const fixtures=process.env.LABOS_DEV_HISTORY_FIXTURES==='rollback-only';
try{
 await client.query(fixtures?'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ':'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query("SET LOCAL statement_timeout='15s'");
 await client.query("SET LOCAL lock_timeout='1s'");
 const projects=(await client.query('SELECT DISTINCT project_id FROM project_experiments ORDER BY project_id LIMIT 2')).rows;
 assert.ok(projects.length,'Development experiment fixtures required; no coverage claimed');
 if(fixtures){
  assert.equal(projects.length,2,'Two development projects required for fixture isolation check');
  for(const {project_id} of projects){
   const experiment=(await client.query('SELECT id FROM project_experiments WHERE project_id=$1 ORDER BY id LIMIT 1',[project_id])).rows[0];
   for(const entityType of ['project_experiment','project_experiment','project_task']){
    const id=randomUUID();fixtureIds.push(id);
    await client.query(`INSERT INTO audit_log(id,action,entity_type,entity_id,old_value,new_value,metadata,created_at)
      VALUES($1,'UPDATE',$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,'2026-01-01T00:00:00Z')`,
      [id,entityType,experiment.id,JSON.stringify({title:'Before probe'}),JSON.stringify({title:'After probe'}),JSON.stringify({probe:'rollback-only',project_id})]);
   }
  }
 }
 assert.deepEqual(await readExperimentHistorySnapshot(client,[]),[]);
 let records=0;
 for(const {project_id} of projects){
  const actual=await readExperimentHistorySnapshot(client,[project_id]);
  const experiments=(await client.query('SELECT id FROM project_experiments WHERE project_id=$1 ORDER BY id',[project_id])).rows;
  const allowed=new Set(experiments.map(e=>e.id));
  assert.ok(actual.every(event=>allowed.has(event.experiment_id)),'History escaped requested project scope');
  const expected=[];
  for(const experiment of experiments){
   // Reference the existing HTTP history endpoint's semantics independently.
   const rows=(await client.query(`SELECT a.id,a.action,a.old_value,a.new_value,a.metadata,a.created_at,u.username AS actor_username
    FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id
    WHERE a.entity_type='project_experiment' AND a.entity_id::text=$1
    ORDER BY a.created_at DESC,a.id DESC`,[experiment.id])).rows;
   expected.push(...rows.map(row=>({experiment_id:experiment.id,...row})));
  }
  assert.deepEqual(actual,expected,'Snapshot differs from per-experiment audit endpoint semantics');
  records+=actual.length;
 }
 assert.ok(records>0,'Query succeeded but no audit fixtures exist; nonempty history verification remains blocked');
 if(fixtures)assert.equal(records>=4,true,'Expected synthetic experiment history to be present');
 console.log(`PASS: ${projects.length} development project scopes; ${records} audit records; endpoint parity, scope isolation and empty scope. ${fixtures?'Rollback-only fixtures':'Read-only transaction'}.`);
 console.log('Not verified here: authenticated project visibility selection, native persistence, outage/reconnect or UI acceptance.');
}finally{
 try{
  await client.query('ROLLBACK');
  if(fixtureIds.length){
   assert.equal((await client.query('SELECT id FROM audit_log WHERE id=ANY($1::uuid[])',[fixtureIds])).rowCount,0,'Probe fixtures survived rollback');
   console.log(`PASS: all ${fixtureIds.length} temporary audit fixtures absent after rollback.`);
  }
 }finally{client.release();await pool.end();}
}
