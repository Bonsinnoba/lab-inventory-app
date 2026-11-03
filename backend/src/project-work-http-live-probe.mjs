// Real development PostgreSQL + production auth/routes. All fixture effects roll back.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
import {authenticateToken} from './middleware/auth.js';
import {projectWorkspaceBoundary} from './middleware/project-workspace-boundary.js';
import projectsRouter from './routes/projects.js';
import workspaceRouter from './routes/project-workspace.js';
import syncRouter from './routes/sync.js';
import canvasRouter from './routes/project-blocks.js';
import projectConnectors from './routes/project-connectors.js';
import blocksRouter from './routes/blocks.js';
import connectorsRouter from './routes/connectors.js';
import operationsRouter from './routes/operations.js';
import {operationsProjectBoundary} from './middleware/operations-project-boundary.js';
import {workSnapshot} from './project-work-http.js';

if(process.env.LABOS_DEV_PROJECT_WORK_PROBE!=='rollback-only')throw Error('Explicit development rollback-only opt-in required');
const c=await pool.connect(),originalQuery=pool.query,originalConnect=pool.connect;
const actor=randomUUID(),target=randomUUID(),lead=randomUUID(),project=randomUUID(),keys=[];
let server,active=false,failAt=null,authorityChange=null;
try{
 await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='10s'");
 for(const [id,role] of [[actor,'admin'],[target,'researcher'],[lead,'researcher']])await c.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'no-login',$3,true)",[id,`work-probe-${id}`,role]);
 await c.query("INSERT INTO projects(id,name,owner_id,visibility) VALUES($1,'Rollback project work',$2,'restricted')",[project,actor]);
 await c.query("INSERT INTO project_members(project_id,user_id,member_role) VALUES($1,$2,'lead')",[project,lead]);
 await c.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,'projects.edit','grant')",[lead]);
 pool.query=(...args)=>c.query(...args);
 pool.connect=async()=>({async query(sql,args){
  if(sql==='BEGIN'){
   assert.equal(active,false);await c.query('SAVEPOINT work_route');active=true;
   if(authorityChange==='demote')await c.query("UPDATE users SET role='viewer' WHERE id=$1",[actor]);
   if(authorityChange==='disable')await c.query('UPDATE users SET is_active=false WHERE id=$1',[actor]);
   if(authorityChange==='deny'){await c.query("UPDATE users SET role='researcher' WHERE id=$1",[actor]);await c.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,'projects.edit','deny')",[actor]);}
   if(authorityChange==='target-disable')await c.query('UPDATE users SET is_active=false WHERE id=$1',[target]);
   return;
  }
  if(sql==='COMMIT'){await c.query('RELEASE SAVEPOINT work_route');active=false;return;}
  if(sql==='ROLLBACK'){if(active){await c.query('ROLLBACK TO SAVEPOINT work_route');await c.query('RELEASE SAVEPOINT work_route');active=false;}return;}
  if(failAt==='audit'&&sql.includes('INSERT INTO audit_log')||failAt==='receipt'&&sql.startsWith('INSERT INTO sync_idempotency'))return c.query('SELECT 1/0');
  return c.query(sql,args);
 },release(){assert.equal(active,false);}});
 const app=express();app.use(express.json());app.use('/api/projects',authenticateToken,projectWorkspaceBoundary,workspaceRouter,canvasRouter,projectConnectors,projectsRouter);app.use('/api/sync',authenticateToken,syncRouter);app.use('/api/blocks',authenticateToken,blocksRouter);app.use('/api/connectors',authenticateToken,connectorsRouter);app.use('/api/operations',authenticateToken,operationsProjectBoundary,operationsRouter);
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:{code:error.code||'PROBE_ERROR'}}));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 async function tokenFor(userId){const version=(await c.query('SELECT credential_version FROM users WHERE id=$1',[userId])).rows[0].credential_version;return jwt.sign({userId,credentialVersion:version},config.jwtSecret,{expiresIn:'5m'});}
 const token=await tokenFor(actor),leadToken=await tokenFor(lead);
 async function request(method,path,body,status,key=randomUUID(),bearer=token){
  keys.push(key);
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/projects/${project}/${path}`,{method,headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json','Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  const result=response.status===204?null:await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;
 }

 const taskKey=randomUUID(),taskBody={title:'Reviewed task',due_date:''};
 for(const failure of ['audit','receipt']){
  failAt=failure;await request('POST','tasks',taskBody,500,taskKey);failAt=null;
  assert.equal((await c.query('SELECT 1 FROM project_tasks WHERE id=$1',[taskKey])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[taskKey])).rowCount,0);
 }
 const task=await request('POST','tasks',taskBody,201,taskKey);
 assert.equal(task.id,taskKey);assert.equal(task.due_date,null);
 await request('POST','tasks',taskBody,201,taskKey);
 assert.equal((await c.query("SELECT 1 FROM audit_log WHERE entity_type='project_task' AND entity_id=$1",[task.id])).rowCount,1);
 await request('POST','tasks',{title:'mismatched key'},409,taskKey);
 const taskPath=`tasks/${task.id}`,base=workSnapshot('task',task);
 const updateKey=randomUUID(),updateBody={title:'Updated',expected:base};
 for(const failure of ['audit','receipt']){
  failAt=failure;await request('PATCH',taskPath,updateBody,500,updateKey);failAt=null;
  assert.equal((await c.query('SELECT title FROM project_tasks WHERE id=$1',[task.id])).rows[0].title,task.title);
 }
 const updated=await request('PATCH',taskPath,updateBody,200,updateKey);
 await request('PATCH',taskPath,{title:'stale edit',expected:base},409);
 await request('DELETE',taskPath,{expected:base},409);
 const latest=await request('PATCH',taskPath,{title:'Newer title',expected:workSnapshot('task',updated)},200);
 await request('PATCH',taskPath,updateBody,200,updateKey);
 assert.equal((await c.query('SELECT title FROM project_tasks WHERE id=$1',[task.id])).rows[0].title,latest.title);
 const experiment=await request('POST','experiments',{title:'Experiment',hypothesis:'H',procedure:'P'},201);
 const ep=`experiments/${experiment.id}`,repeatKey=randomUUID(),repeatBody={expected:workSnapshot('experiment',experiment)};
 const repeated=await request('POST',`${ep}/repeat`,repeatBody,201,repeatKey);
 await request('POST',`${ep}/repeat`,repeatBody,201,repeatKey);
 assert.equal(repeated.id,repeatKey);assert.equal(repeated.status,'planned');assert.equal(repeated.result,'');
 assert.equal((await c.query('SELECT 1 FROM project_experiments WHERE id=$1',[repeatKey])).rowCount,1);
 const linkKey=randomUUID(),linkBody={experiment_id:experiment.id,relationship:'validates',expected_relationship:null};
 const link=await request('POST',`${taskPath}/experiments`,linkBody,201,linkKey);assert.equal(link.id,linkKey);
 await request('POST',`${taskPath}/experiments`,linkBody,201,linkKey);
 await request('POST',`${taskPath}/experiments`,{...linkBody,relationship:'drives'},409);
 const unlinkKey=randomUUID(),unlinkPath=`${taskPath}/experiments/${experiment.id}`;
 await request('DELETE',unlinkPath,{expected_relationship:'related'},409);
 await request('DELETE',unlinkPath,{expected_relationship:'validates'},204,unlinkKey);
 const link2=await request('POST',`${taskPath}/experiments`,{...linkBody,relationship:'drives'},201);
 await request('DELETE',unlinkPath,{expected_relationship:'validates'},204,unlinkKey);
 assert.equal((await c.query('SELECT relationship FROM project_task_experiments WHERE id=$1',[link2.id])).rows[0].relationship,'drives');
 // Planning is metadata only: no stock movement, reservation or money effect.
 const inventory=randomUUID();await c.query("INSERT INTO items(id,name,type,status,current_quantity,initial_quantity) VALUES($1,'Planning fixture','component','available',10,10)",[inventory]);
 const bomKey=randomUUID(),bomBody={name:'Planned part',required_quantity:1.001,notes:''};
 for(const failure of ['audit','receipt']){
  failAt=failure;await request('POST','bom',bomBody,500,bomKey);failAt=null;
  assert.equal((await c.query('SELECT 1 FROM project_bom_items WHERE id=$1',[bomKey])).rowCount,0);
 }
 const bom=await request('POST','bom',bomBody,201,bomKey);await request('POST','bom',bomBody,201,bomKey);
 const bomUpdated=await request('PATCH',`bom/${bom.id}`,{required_quantity:2,expected:workSnapshot('bom',bom)},200);
 await request('PATCH',`bom/${bom.id}`,{notes:'stale',expected:workSnapshot('bom',bom)},409);
 await request('POST','bom',{name:'Invalid rounding',required_quantity:.0001},400);
 const bomDeleteKey=randomUUID(),bomDeleteBody={expected:workSnapshot('bom',bomUpdated)};
 for(const failure of ['audit','receipt']){failAt=failure;await request('DELETE',`bom/${bom.id}`,bomDeleteBody,500,bomDeleteKey);failAt=null;assert.equal((await c.query('SELECT 1 FROM project_bom_items WHERE id=$1',[bom.id])).rowCount,1);}
 await request('DELETE',`bom/${bom.id}`,bomDeleteBody,204,bomDeleteKey);await request('DELETE',`bom/${bom.id}`,bomDeleteBody,204,bomDeleteKey);
 const itemKey=randomUUID(),itemBody={item_id:inventory,allocated_quantity:2,notes:'plan',expected:null};
 for(const failure of ['audit','receipt']){failAt=failure;await request('POST','items',itemBody,500,itemKey);failAt=null;assert.equal((await c.query('SELECT 1 FROM project_items WHERE project_id=$1 AND item_id=$2',[project,inventory])).rowCount,0);}
 const itemLink=await request('POST','items',itemBody,201,itemKey);await request('POST','items',itemBody,201,itemKey);
 await request('POST','items',{...itemBody,allocated_quantity:5},409);
 const itemChanged=await request('POST','items',{...itemBody,allocated_quantity:3,expected:itemLink},201);
 await request('POST','items',itemBody,201,itemKey);assert.equal(Number((await c.query('SELECT allocated_quantity FROM project_items WHERE project_id=$1 AND item_id=$2',[project,inventory])).rows[0].allocated_quantity),3);
 await request('DELETE',`items/${inventory}`,{expected:itemLink},409);
 const itemDeleteKey=randomUUID(),itemDeleteBody={expected:itemChanged};
 await request('DELETE',`items/${inventory}`,itemDeleteBody,204,itemDeleteKey);
 await request('POST','items',itemBody,201);await request('DELETE',`items/${inventory}`,itemDeleteBody,204,itemDeleteKey);
 assert.equal((await c.query('SELECT 1 FROM project_items WHERE project_id=$1 AND item_id=$2',[project,inventory])).rowCount,1);
 // Exercise the production push path, including UUID audit identity for a composite entity ID.
 const pushKey=randomUUID(),pushChange={change_id:pushKey,entity_type:'project_item',entity_id:`${project}:${inventory}`,operation:'upsert',payload:{record:{project_id:project,item_id:inventory,allocated_quantity:4,notes:'native'},expected:{allocated_quantity:2,notes:'plan'}}};
 async function push(change){keys.push(change.change_id);const response=await fetch(`http://127.0.0.1:${server.address().port}/api/sync/push`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({device_id:'rollback-planning-probe',changes:[change]}),signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);return (await response.json()).results[0];}
 for(const failure of ['audit','receipt']){failAt=failure;assert.notEqual((await push(pushChange)).status,'synced');failAt=null;assert.equal(Number((await c.query('SELECT allocated_quantity FROM project_items WHERE project_id=$1 AND item_id=$2',[project,inventory])).rows[0].allocated_quantity),2);}
 assert.equal((await push(pushChange)).status,'synced');assert.equal((await push(pushChange)).status,'synced');
 assert.equal((await c.query("SELECT 1 FROM audit_log WHERE entity_type='project_item' AND entity_id=$1 AND metadata->>'sync_entity_id'=$2",[inventory,pushChange.entity_id])).rowCount,1);
 assert.equal(Number((await c.query('SELECT current_quantity FROM items WHERE id=$1',[inventory])).rows[0].current_quantity),10);
 assert.equal((await c.query('SELECT 1 FROM item_movements WHERE item_id=$1',[inventory])).rowCount,0);
 // Canvas and requirement flat routes must retain replay after deletion.
 async function flat(method,path,body,status,key=randomUUID()){
  keys.push(key);const response=await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const result=response.status===204?null:await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;
 }
 const blockKey=randomUUID(),blockBody={block_type:'text',text_content:'Reviewed canvas',x:1.6};
 for(const failure of ['audit','receipt']){failAt=failure;await request('POST','blocks',blockBody,500,blockKey);failAt=null;assert.equal((await c.query('SELECT 1 FROM project_blocks WHERE id=$1',[blockKey])).rowCount,0);}
 const block=await request('POST','blocks',blockBody,201,blockKey);assert.equal(block.x,2);await request('POST','blocks',blockBody,201,blockKey);
 await request('POST','blocks',{...blockBody,width:119},400);
 const second=await request('POST','blocks',{block_type:'text',text_content:'Second'},201);
 const connectorKey=randomUUID(),connectorBody={source_block_id:block.id,target_block_id:second.id};
 for(const failure of ['audit','receipt']){failAt=failure;await request('POST','connectors',connectorBody,500,connectorKey);failAt=null;assert.equal((await c.query('SELECT 1 FROM project_connectors WHERE id=$1',[connectorKey])).rowCount,0);}
 const connector=await request('POST','connectors',connectorBody,201,connectorKey);await request('POST','connectors',connectorBody,201,connectorKey);
 await request('POST','connectors',{source_block_id:block.id,target_block_id:block.id},400);
 const editKey=randomUUID(),editBody={project_id:project,title:'Saved title',expected:workSnapshot('block',block)};
 const edited=await flat('PUT',`blocks/${block.id}`,editBody,200,editKey);
 await flat('PUT',`blocks/${block.id}`,{project_id:project,text_content:'Stale edit',expected:workSnapshot('block',block)},409);
 const deleteBlockKey=randomUUID(),deleteBlockBody={project_id:project,expected:workSnapshot('block',edited)};
 for(const failure of ['audit','receipt']){failAt=failure;await flat('DELETE',`blocks/${block.id}`,deleteBlockBody,500,deleteBlockKey);failAt=null;assert.equal((await c.query('SELECT 1 FROM project_connectors WHERE id=$1',[connector.id])).rowCount,1);assert.equal((await c.query('SELECT 1 FROM sync_tombstones WHERE entity_id=ANY($1::uuid[])',[[block.id,connector.id]])).rowCount,0);}
 await flat('DELETE',`blocks/${block.id}`,deleteBlockBody,204,deleteBlockKey);await flat('DELETE',`blocks/${block.id}`,deleteBlockBody,204,deleteBlockKey);
 assert.equal((await c.query('SELECT 1 FROM sync_tombstones WHERE entity_id=ANY($1::uuid[])',[[block.id,connector.id]])).rowCount,2);
 const requirementKey=randomUUID(),requirementBody={project_id:project,name:'Canonical demand',quantity:1,required_by:''};
 for(const failure of ['audit','receipt']){failAt=failure;await flat('POST','operations/requirements',requirementBody,500,requirementKey);failAt=null;assert.equal((await c.query('SELECT 1 FROM project_resource_requirements WHERE id=$1',[requirementKey])).rowCount,0);}
 const requirement=await flat('POST','operations/requirements',requirementBody,201,requirementKey);assert.equal(requirement.required_by,null);await flat('POST','operations/requirements',requirementBody,201,requirementKey);
 const requirementEdited=await flat('PATCH',`operations/requirements/${requirement.id}`,{project_id:project,quantity:2,expected:workSnapshot('requirement',requirement)},200);
 await flat('PATCH',`operations/requirements/${requirement.id}`,{project_id:project,quantity:3,expected:workSnapshot('requirement',requirement)},409);
 const reqDeleteBody={project_id:project,expected:workSnapshot('requirement',requirementEdited)},reqDeleteKey=randomUUID();
 await c.query('UPDATE project_tasks SET requirement_id=$1 WHERE id=$2',[requirement.id,task.id]);await flat('DELETE',`operations/requirements/${requirement.id}`,reqDeleteBody,409);
 await c.query('UPDATE project_tasks SET requirement_id=NULL WHERE id=$1',[task.id]);
 await flat('DELETE',`operations/requirements/${requirement.id}`,reqDeleteBody,204,reqDeleteKey);await flat('DELETE',`operations/requirements/${requirement.id}`,reqDeleteBody,204,reqDeleteKey);
 // Work attachments: same project/resource authority, retry and scoped detach.
 const resource=randomUUID(),otherResource=randomUUID();
 await c.query("INSERT INTO resources(id,name,kind,file_type,project_id,visibility,category) VALUES($1,'Attachment fixture','link','other',$2,'restricted','reference')",[resource,project]);
 await c.query("INSERT INTO resources(id,name,kind,file_type,category) VALUES($1,'Unattached fixture','link','other','reference')",[otherResource]);
 const ap=`${taskPath}/attachments`,attachKey=randomUUID(),attachBody={resource_id:resource};
 for(const failure of ['audit','receipt']){
  failAt=failure;await request('POST',ap,attachBody,500,attachKey);failAt=null;
  assert.equal((await c.query('SELECT 1 FROM project_work_attachments WHERE id=$1',[attachKey])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[attachKey])).rowCount,0);
 }
 const attachment=await request('POST',ap,attachBody,201,attachKey);
 assert.equal(attachment.task_id,task.id);assert.equal(attachment.resource_id,resource);
 await request('POST',ap,attachBody,201,attachKey);
 await request('POST',ap,attachBody,409); // Different intention cannot duplicate the pair.
 await request('POST',ap,{resource_id:otherResource},404);
 const siblingTask=await request('POST','tasks',{title:'Sibling task'},201);
 await request('DELETE',`tasks/${siblingTask.id}/attachments/${attachment.id}`,{expected_resource_id:resource},409);
 await request('DELETE',`${ap}/${attachment.id}`,{expected_resource_id:otherResource},409);
 await c.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('project',$1,$2,'edit',$3)",[project,lead,actor]);
 await request('POST',`${ep}/attachments`,attachBody,404,randomUUID(),leadToken);
 await c.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES('resource',$1,$2,'view',$3)",[resource,lead,actor]);
 const leadKey=randomUUID(),leadAttachment=await request('POST',`${ep}/attachments`,attachBody,201,leadKey,leadToken);
 await c.query("DELETE FROM record_access_grants WHERE entity_type='resource' AND entity_id=$1 AND user_id=$2",[resource,lead]);
 await request('POST',`${ep}/attachments`,attachBody,404,leadKey,leadToken); // Replay cannot use a revoked resource grant.
 await request('DELETE',`${ep}/attachments/${leadAttachment.id}`,{expected_resource_id:resource},204,randomUUID(),leadToken); // Cleanup does not expose or require the old resource.
 const detachKey=randomUUID(),detachBody={expected_resource_id:resource};
 for(const failure of ['audit','receipt']){
  failAt=failure;await request('DELETE',`${ap}/${attachment.id}`,detachBody,500,detachKey);failAt=null;
  assert.equal((await c.query('SELECT 1 FROM project_work_attachments WHERE id=$1',[attachment.id])).rowCount,1);
  assert.equal((await c.query("SELECT 1 FROM sync_tombstones WHERE entity_type='project_work_attachment' AND entity_id=$1",[attachment.id])).rowCount,0);
 }
 await request('DELETE',`${ap}/${attachment.id}`,detachBody,204,detachKey);
 const replacement=await request('POST',ap,attachBody,201);
 await request('DELETE',`${ap}/${attachment.id}`,detachBody,204,detachKey);
 assert.equal((await c.query('SELECT 1 FROM project_work_attachments WHERE id=$1',[replacement.id])).rowCount,1);
 assert.equal((await c.query('SELECT 1 FROM resources WHERE id=$1',[resource])).rowCount,1);
 // Parent deletion must retain child deletion evidence, atomically with audit.
 const measurementKey=randomUUID(),measurementBody={name:'Voltage',value_numeric:0,observed_at:''};
 for(const failure of ['audit','receipt']){
  failAt=failure;await request('POST',`${ep}/measurements`,measurementBody,500,measurementKey);failAt=null;
  assert.equal((await c.query('SELECT 1 FROM project_experiment_measurements WHERE id=$1',[measurementKey])).rowCount,0);
 }
 const measurement=await request('POST',`${ep}/measurements`,measurementBody,201,measurementKey);
 await request('POST',`${ep}/measurements`,measurementBody,201,measurementKey);assert.equal(measurement.observed_at,null);
 const measurementPath=`${ep}/measurements/${measurement.id}`;
 await request('PATCH',`experiments/${repeated.id}/measurements/${measurement.id}`,{name:'Cross parent',expected:workSnapshot('measurement',measurement)},404);
 const measured=await request('PATCH',measurementPath,{name:'Verified voltage',expected:workSnapshot('measurement',measurement)},200);
 await request('DELETE',measurementPath,{expected:workSnapshot('measurement',measurement)},409);
 const measurementDeleteKey=randomUUID(),measurementDeleteBody={expected:workSnapshot('measurement',measured)};
 await request('DELETE',measurementPath,measurementDeleteBody,204,measurementDeleteKey);await request('DELETE',measurementPath,measurementDeleteBody,204,measurementDeleteKey);
 const childMeasurement=await request('POST',`${ep}/measurements`,{name:'Current',value_text:'unknown'},201);
 const observationRow=await request('POST',`${ep}/observations`,{content:'original'},201);
 const observation=observationRow.id;
 const deleteKey=randomUUID(),deleteBody={expected:workSnapshot('experiment',experiment)};
 for(const failure of ['audit','receipt']){
  failAt=failure;await request('DELETE',ep,deleteBody,500,deleteKey);failAt=null;
  assert.equal((await c.query('SELECT 1 FROM project_experiments WHERE id=$1',[experiment.id])).rowCount,1);
  assert.equal((await c.query('SELECT 1 FROM project_experiment_observations WHERE id=$1',[observation])).rowCount,1);
  assert.equal((await c.query('SELECT 1 FROM sync_tombstones WHERE entity_id=ANY($1::uuid[])',[[experiment.id,observation,link2.id,childMeasurement.id]])).rowCount,0);
 }
 await request('DELETE',ep,deleteBody,204,deleteKey);await request('DELETE',ep,deleteBody,204,deleteKey);
 assert.equal((await c.query('SELECT 1 FROM sync_tombstones WHERE entity_id=ANY($1::uuid[])',[[experiment.id,observation,link2.id,childMeasurement.id]])).rowCount,4);
 for(const change of ['demote','disable','deny']){
  authorityChange=change;await request('POST','tasks',taskBody,403,taskKey);authorityChange=null;
  assert.equal((await c.query('SELECT role FROM users WHERE id=$1',[actor])).rows[0].role,'admin');
 }
 console.log('PASS: actual PostgreSQL work create/edit/delete/repeat/link replay, stale bases, authority rechecks and atomic audit/receipt/tombstones.');
}finally{
 if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
 pool.query=originalQuery;pool.connect=originalConnect;
 try{
  await c.query('ROLLBACK');
  assert.equal((await c.query('SELECT 1 FROM users WHERE id=ANY($1::uuid[])',[[actor,target,lead]])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM projects WHERE id=$1',[project])).rowCount,0);
  assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=ANY($1::text[])',[keys])).rowCount,0);
  console.log('PASS: work fixtures absent after rollback.');
 }finally{c.release();await pool.end();}
}
