// Actual PostgreSQL + production auth/sync/proposal routers. Provider stubbed;
// all fixtures, effects, audits and receipts roll back together.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import {readFileSync} from 'node:fs';
import {pool} from './db.js';
import {config} from './config.js';
import {authenticateToken} from './middleware/auth.js';
import sync from './routes/sync.js';
import {createProposalRouter} from './routes/assistant-proposals.js';
import {validateProposalGraph,proposalDigest} from './assistant-proposal-contract.js';
if(process.env.LABOS_DEV_PROPOSALS_PROBE!=='rollback-only')throw Error('Explicit rollback-only opt-in required');
const c=await pool.connect(),originalQuery=pool.query,originalConnect=pool.connect,actor=randomUUID(),outsider=randomUUID(),target=randomUUID(),device=randomUUID(),proposal=randomUUID(),keys=[];
let server,active=false,failAt=null,demote=false,providerCalls=0;
try{
 await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='15s'");
 for(const id of [actor,outsider])await c.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'no-login','researcher',true)",[id,`proposal-${id}`]);
 await c.query("INSERT INTO projects(id,name,owner_id,visibility,status) VALUES($1,'Reviewed existing project',$2,'restricted','active')",[target,actor]);
 await c.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level) VALUES('project',$1,$2,'edit')",[target,actor]);
 pool.query=(...args)=>c.query(...args);pool.connect=async()=>({async query(sql,args){
  if(sql==='BEGIN'){assert.equal(active,false);await c.query('SAVEPOINT proposal_route');active=true;if(demote)await c.query("UPDATE users SET role='viewer' WHERE id=$1",[actor]);return;}
  if(sql==='COMMIT'){await c.query('RELEASE SAVEPOINT proposal_route');active=false;return;}
  if(sql==='ROLLBACK'){if(active){await c.query('ROLLBACK TO SAVEPOINT proposal_route');await c.query('RELEASE SAVEPOINT proposal_route');active=false;}return;}
  if(failAt==='audit'&&sql.includes('INSERT INTO audit_log')||failAt==='receipt'&&sql.startsWith('INSERT INTO sync_idempotency')||failAt==='child'&&sql.startsWith('INSERT INTO project_experiments'))return c.query('SELECT 1/0');return c.query(sql,args);
 },release(){assert.equal(active,false);}});
 const app=express();app.use(express.json());app.use('/sync',authenticateToken,sync);app.use('/proposals',authenticateToken,createProposalRouter({configured:()=>true,generate:async()=>{providerCalls++;return{name:'Generated plan',description:'Suggestion',tasks:[{title:'Human task'}],experiments:[{title:'Human experiment'}],links:[{task_index:0,experiment_index:0}]};}}));app.use((error,req,res,next)=>res.status(error.status||500).json({error:{code:error.code||'PROBE_ERROR',message:error.status?error.message:'Internal fixture failure'}}));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 async function token(id){const version=(await c.query('SELECT credential_version FROM users WHERE id=$1',[id])).rows[0].credential_version;return jwt.sign({userId:id,credentialVersion:version},config.jwtSecret,{expiresIn:'5m'});}
 const bearer=await token(actor),other=await token(outsider);
 async function request(path,{method='GET',body,key,bearerToken=bearer,status=200}={}){const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{Authorization:`Bearer ${bearerToken}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
 const generation=randomUUID(),generationBody={prompt:'Plan a safe bench test',target_project_id:target};
 const generated=await request('/proposals/generate',{method:'POST',body:generationBody,key:generation});assert.equal(generated.state,'ready');assert.deepEqual(await request('/proposals/generate',{method:'POST',body:generationBody,key:generation}),generated);assert.equal(providerCalls,1);
 await request('/proposals/generate',{method:'POST',body:{...generationBody,prompt:'Changed retry'},key:generation,status:409});await request(`/proposals/generations/${generation}`,{bearerToken:other,status:404});
 assert.equal((await c.query('SELECT 1 FROM project_tasks WHERE project_id=$1',[target])).rowCount,0);
 const cases=JSON.parse(readFileSync(new URL('../../contracts/assistant-proposal-cases.json',import.meta.url),'utf8'));let graph=validateProposalGraph(cases[0].input);
 const event=(operation,payload,id=proposal)=>{const change={change_id:randomUUID(),entity_type:'assistant_proposal',entity_id:id,operation,payload};keys.push(change.change_id);return change;};
 async function push(change,bearerToken=bearer){return(await request('/sync/push',{method:'POST',body:{device_id:device,changes:[change]},bearerToken})).results[0];}
 const save=event('save',{expected_revision:0,title:'Reviewed plan',graph,generation_id:null});
 for(const failure of ['audit','receipt']){failAt=failure;assert.equal((await push(save)).status,'failed');failAt=null;assert.equal((await c.query('SELECT 1 FROM assistant_proposals WHERE id=$1',[proposal])).rowCount,0);}
 const saved=await push(save);assert.equal(saved.status,'synced');assert.equal(saved.result.revision,1);assert.deepEqual(await push(save),saved);assert.equal((await c.query('SELECT 1 FROM projects WHERE id=$1',[graph.target.project_id])).rowCount,0);
 assert.equal((await push({...save,payload:{...save.payload,title:'Changed retry'}})).status,'rejected');
 const update=event('save',{expected_revision:1,title:'Reviewed revision two',graph,generation_id:null});assert.equal((await push(update)).status,'synced');assert.equal((await push(event('save',{...update.payload,title:'stale'}))).status,'rejected');
 assert.equal((await push(event('save',{expected_revision:0,title:'Steal proposal',graph,generation_id:null}),other)).status,'rejected');
 const accept=event('accept',{expected_revision:2,graph_digest:proposalDigest(graph),graph,confirmed:true});
 assert.equal((await push({...accept,change_id:randomUUID(),payload:{...accept.payload,confirmed:false}})).status,'rejected');assert.equal((await push({...accept,change_id:randomUUID(),payload:{...accept.payload,graph_digest:'wrong'}})).status,'rejected');
 for(const failure of ['child','audit','receipt']){
  failAt=failure;assert.equal((await push(accept)).status,'failed');failAt=null;
  assert.equal((await c.query('SELECT 1 FROM projects WHERE id=$1',[graph.target.project_id])).rowCount,0);assert.equal((await c.query('SELECT 1 FROM project_tasks WHERE id=$1',[graph.tasks[0].id])).rowCount,0);
  assert.equal((await c.query('SELECT state FROM assistant_proposals WHERE id=$1',[proposal])).rows[0].state,'draft');assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[accept.change_id])).rowCount,0);
 }
 const accepted=await push(accept);assert.equal(accepted.status,'synced');assert.deepEqual(accepted.result.applied,{projects:1,tasks:1,experiments:1,links:1});assert.deepEqual(await push(accept),accepted);
 assert.equal((await push(event('accept',accept.payload))).status,'rejected');
 const project=(await c.query('SELECT * FROM projects WHERE id=$1',[graph.target.project_id])).rows[0];assert.equal(project.status,'planning');assert.equal(project.owner_id,actor);assert.equal(project.visibility,'project');
 const task=(await c.query('SELECT * FROM project_tasks WHERE id=$1',[graph.tasks[0].id])).rows[0];assert.equal(task.status,'todo');assert.equal(task.created_by,actor);
 const experiment=(await c.query('SELECT * FROM project_experiments WHERE id=$1',[graph.experiments[0].id])).rows[0];assert.equal(experiment.status,'planned');assert.equal(experiment.result,'');assert.equal(experiment.performed_by,null);
 assert.equal((await c.query('SELECT 1 FROM project_task_experiments WHERE id=$1',[graph.links[0].id])).rowCount,1);
 for(const table of ['item_movements','item_custody_records','transactions','project_reservations'])assert.equal((await c.query(`SELECT 1 FROM ${table} WHERE project_id=$1`,[project.id])).rowCount,0);
 assert.equal((await c.query("SELECT 1 FROM audit_log WHERE action='assistant:accepted_create' AND metadata->>'proposal_id'=$1",[proposal])).rowCount,4);
 demote=true;assert.equal((await push(accept)).status,'rejected');demote=false;
 const existingId=randomUUID(),existing=generated.result.graph;assert.equal((await push(event('save',{expected_revision:0,title:'Existing work',graph:existing,generation_id:generation},existingId))).status,'synced');
 // The real trigger owns lifecycle_revision: changing that column directly is
 // intentionally ignored. Exercise a real lifecycle transition instead.
 await c.query("UPDATE projects SET status='planning' WHERE id=$1",[target]);assert.equal((await push(event('accept',{expected_revision:1,graph_digest:proposalDigest(existing),graph:existing,confirmed:true},existingId))).status,'rejected');
 await c.query("DELETE FROM record_access_grants WHERE entity_type='project' AND entity_id=$1 AND user_id=$2",[target,actor]);
 const page=await request('/proposals/pull');assert.ok(page.records.some(row=>row.id===proposal));assert.ok(!page.records.some(row=>row.id===existingId));assert.equal((await c.query('SELECT 1 FROM assistant_proposals WHERE id=$1',[existingId])).rowCount,1);
 console.log('PASS: actual PostgreSQL generated request identity/provenance, private ownership, draft-only saves, stale review rejection and atomic canonical project/task/experiment/link acceptance; SQL child/audit/receipt failures roll back all effects, replay cannot double-accept, and no physical/financial effects occur. Provider stubbed.');
}finally{
 if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});pool.query=originalQuery;pool.connect=originalConnect;
 try{await c.query('ROLLBACK');assert.equal((await c.query('SELECT 1 FROM users WHERE id=ANY($1::uuid[])',[[actor,outsider]])).rowCount,0);assert.equal((await c.query('SELECT 1 FROM sync_idempotency WHERE change_id=ANY($1::text[])',[keys])).rowCount,0);console.log('PASS: proposal fixtures/effects rolled back.');}finally{c.release();await pool.end();}
}
