// Development-only snapshot checks. Optional fixtures always roll back.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';

if(process.env.LABOS_DEV_COLLECTION_PROBE!=='1')throw Error('Explicit development collection probe opt-in required');
const client=await pool.connect();
const fixtures=process.env.LABOS_DEV_COLLECTION_FIXTURES==='rollback-only';
const cleanupChecks=[];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const queries=[
 ['bom','SELECT * FROM project_bom_items WHERE project_id=ANY($1::uuid[]) ORDER BY created_at','id'],
 ['blocks','SELECT * FROM project_blocks WHERE project_id=ANY($1::uuid[]) ORDER BY created_at','id'],
 ['connectors','SELECT * FROM project_connectors WHERE project_id=ANY($1::uuid[]) ORDER BY created_at','id'],
 ['requirements','SELECT * FROM project_resource_requirements WHERE project_id=ANY($1::uuid[]) ORDER BY required_by NULLS LAST,created_at','id'],
 ['items','SELECT pi.project_id,pi.item_id,pi.allocated_quantity,pi.notes,i.name,i.type,i.status AS item_status,i.current_quantity,i.unit,i.sku FROM project_items pi JOIN items i ON i.id=pi.item_id WHERE pi.project_id=ANY($1::uuid[]) ORDER BY i.name','item_id'],
 ['task_experiments','SELECT te.* FROM project_task_experiments te WHERE te.project_id=ANY($1::uuid[]) ORDER BY te.created_at','id'],
];
try{
 await client.query(fixtures?'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ':'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 await client.query("SET LOCAL statement_timeout='15s'");
 await client.query("SET LOCAL lock_timeout='1s'");
 const ids=(await client.query('SELECT id FROM projects ORDER BY id')).rows.map(row=>row.id);
 assert.ok(ids.length,'No development project fixtures; no coverage claimed');
 if(fixtures){
  const candidates=(await client.query(`SELECT p.id FROM projects p WHERE EXISTS(SELECT 1 FROM project_tasks t JOIN project_experiments e ON e.project_id=t.project_id WHERE t.project_id=p.id AND NOT EXISTS(SELECT 1 FROM project_task_experiments te WHERE te.task_id=t.id AND te.experiment_id=e.id)) ORDER BY p.id LIMIT 2`)).rows;
  assert.equal(candidates.length,2,'Two projects with unlinked work fixtures required');
  for(const {id:project} of candidates){
   const pair=(await client.query(`SELECT t.id task_id,e.id experiment_id FROM project_tasks t JOIN project_experiments e ON e.project_id=t.project_id WHERE t.project_id=$1 AND NOT EXISTS(SELECT 1 FROM project_task_experiments te WHERE te.task_id=t.id AND te.experiment_id=e.id) ORDER BY t.id,e.id LIMIT 1`,[project])).rows[0];
   const item=(await client.query('SELECT id FROM items i WHERE NOT EXISTS(SELECT 1 FROM project_items pi WHERE pi.project_id=$1 AND pi.item_id=i.id) ORDER BY id LIMIT 1',[project])).rows[0];
   assert.ok(item,'Unlinked inventory fixture required');
   const bom=randomUUID(),source=randomUUID(),target=randomUUID(),connector=randomUUID(),link=randomUUID();
   await client.query("INSERT INTO project_bom_items(id,project_id,name) VALUES($1,$2,'Rollback shape probe')",[bom,project]);
   await client.query("INSERT INTO project_blocks(id,project_id,block_type,text_content) VALUES($1,$3,'text','Rollback shape probe'),($2,$3,'text','Rollback shape probe')",[source,target,project]);
   await client.query('INSERT INTO project_connectors(id,project_id,source_block_id,target_block_id) VALUES($1,$2,$3,$4)',[connector,project,source,target]);
   await client.query('INSERT INTO project_items(project_id,item_id,allocated_quantity) VALUES($1,$2,0)',[project,item.id]);
   await client.query('INSERT INTO project_task_experiments(id,project_id,task_id,experiment_id) VALUES($1,$2,$3,$4)',[link,project,pair.task_id,pair.experiment_id]);
   for(const [table,keys] of [['project_bom_items',[bom]],['project_blocks',[source,target]],['project_connectors',[connector]],['project_task_experiments',[link]]])cleanupChecks.push([`SELECT id FROM ${table} WHERE id=ANY($1::uuid[])`,[keys]]);
   cleanupChecks.push(['SELECT item_id FROM project_items WHERE project_id=$1 AND item_id=$2',[project,item.id]]);
  }
 }
 const allowed=new Set(ids);
 const uncovered=[];
 for(const [name,sql,identity] of queries){
  const result=await client.query(sql,[ids]);
  assert.ok(result.fields.some(field=>field.name===identity),`${name}: missing identity column`);
  assert.ok(result.fields.some(field=>field.name==='project_id'),`${name}: missing project scope`);
  if(name==='items')assert.ok(!result.fields.some(field=>field.name==='id'),'Project-item projection changed identity contract');
  const seen=new Set();
  for(const row of result.rows){
   assert.ok(allowed.has(row.project_id),`${name}: unexpected project scope`);
   assert.ok(uuid.test(row[identity]),`${name}: identity is not canonical UUID`);
   const key=`${row.project_id}:${row[identity]}`;
   assert.ok(!seen.has(key),`${name}: duplicate identity`);seen.add(key);
  }
  assert.equal((await client.query(sql,[[]])).rowCount,0,`${name}: empty scope returned rows`);
  for(const project of ids){
   const scoped=(await client.query(sql,[[project]])).rows;
   assert.ok(scoped.every(row=>row.project_id===project),`${name}: single-project scope leak`);
   assert.equal(scoped.length,result.rows.filter(row=>row.project_id===project).length,`${name}: single-project coverage mismatch`);
  }
  if(!result.rowCount)uncovered.push(name);
  console.log(`PASS ${name}: columns/empty scope; ${result.rowCount} existing rows checked for identity and scope.`);
 }
 if(uncovered.length)console.log(`NOT COVERED: nonempty fixtures for ${uncovered.join(', ')}.`);
 if(fixtures)assert.equal(uncovered.length,0,'Fixture mode requires nonempty coverage for all collections');
 console.log(`Not verified: authenticated endpoint permissions, server mutation receipts, native IPC, offline restart or reconnect. ${fixtures?'Temporary fixtures will roll back.':'No rows written.'}`);
}finally{
 try{
  await client.query('ROLLBACK');
  for(const [sql,params] of cleanupChecks)assert.equal((await client.query(sql,params)).rowCount,0,'Temporary fixture survived rollback');
  if(cleanupChecks.length)console.log(`PASS: ${cleanupChecks.length} fixture absence checks after rollback.`);
 }finally{client.release();await pool.end();}
}
