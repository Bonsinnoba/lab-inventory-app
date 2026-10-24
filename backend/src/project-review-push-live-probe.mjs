// Opt-in actual push-handler probe. Every fixture and migration is rolled back.
// Savepoints model separate route transactions, not simultaneous connections.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {pool} from 'file:///app/src/db.js';
const packet=globalThis.labosReviewPushProbe;
const require=createRequire('/app/package.json');
const data=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const imports=(source,base,overrides={})=>source.replace(/from\s+(['"])([^'"]+)\1/g,(_,quote,spec)=>
  `from ${quote}${overrides[spec]??(spec.startsWith('.')?new URL(spec,base).href:spec==='express'?pathToFileURL(require.resolve(spec)).href:spec)}${quote}`);
const c=await pool.connect();
let routeTransaction=false,failReceipt=false;
const routeClient={async query(sql,values){
  if(sql==='BEGIN'){assert.equal(routeTransaction,false);await c.query('SAVEPOINT review_route');routeTransaction=true;return;}
  if(sql==='COMMIT'){await c.query('RELEASE SAVEPOINT review_route');routeTransaction=false;return;}
  if(sql==='ROLLBACK'){if(routeTransaction){await c.query('ROLLBACK TO SAVEPOINT review_route');await c.query('RELEASE SAVEPOINT review_route');routeTransaction=false;}return;}
  if(failReceipt&&sql.startsWith('INSERT INTO sync_idempotency'))throw Object.assign(new Error('Injected receipt failure'),{code:'PROBE_RECEIPT_FAILURE'});
  return c.query(sql,values);
},release(){assert.equal(routeTransaction,false);}};
globalThis.labosReviewProbePool={connect:async()=>routeClient,query:(...args)=>c.query(...args)};
const db=data('export const pool=globalThis.labosReviewProbePool;');
const audit=data(imports(readFileSync('/app/src/middleware/audit.js','utf8'),'file:///app/src/middleware/audit.js',{'../db.js':db}));
const permissions=data(imports(readFileSync('/app/src/middleware/permissions.js','utf8'),'file:///app/src/middleware/permissions.js',{'../db.js':db}));
const decision=data(imports(packet.decision,'file:///app/src/project-review-decision.js',{'./middleware/audit.js':audit}));
const review=data(imports(packet.review,'file:///app/src/project-review-sync.js',{'./project-review-decision.js':decision,'./middleware/permissions.js':permissions}));
const overrides={'../db.js':db,'../middleware/audit.js':audit,'../middleware/permissions.js':permissions,'../project-review-sync.js':review};
for(const name of ['project-experiment-observations','project-experiment-revisions','project-review-snapshot','sync-receipts']){
  overrides[`../${name}.js`]=data(imports(packet[name],`file:///app/src/${name}.js`));
}
const actor=randomUUID(),other=randomUUID(),project=randomUUID(),device=randomUUID();
const results=[];
async function check(name,fn){
  await c.query('SAVEPOINT probe_check');
  try{await fn();results.push({name,status:'PASS'});}
  catch(e){await c.query('ROLLBACK TO SAVEPOINT probe_check');routeTransaction=false;results.push({name,status:'FAIL',message:e.message.slice(0,700)});}
  finally{failReceipt=false;await c.query('RELEASE SAVEPOINT probe_check');}
}
try{
  const {default:router}=await import(data(imports(packet.route,'file:///app/src/routes/sync.js',overrides)));
  const push=router.stack.find(l=>l.route?.path==='/push'&&l.route.methods.post).route.stack[0].handle;
  async function send(change,options={}){
    let body,error,status=200;
    await push({body:{device_id:options.device??device,changes:[structuredClone(change)]},user:{userId:options.actor??actor,role:'admin'}},
      {status(v){status=v;return this;},json(v){body=v;return this;}},e=>{error=e;});
    if(error)throw error;assert.equal(status,200);return body.results[0];
  }
  const token=async(id=project)=>(await c.query("SELECT 'plan-v1:'||plan_revision::text AS token FROM projects WHERE id=$1",[id])).rows[0].token;
  const intent=async(decision)=>({change_id:randomUUID(),entity_type:'project_review',entity_id:project,operation:'decision',payload:{project_id:project,decision,note:'Preserve this review note',expected_token:await token()}});
  const ok=row=>assert.equal(row.status,'synced',JSON.stringify(row));
  const rejected=(row,code)=>{assert.equal(row.status,'rejected',JSON.stringify(row));assert.equal(row.error.code,code);};
  const state=async()=>({
    project:(await c.query('SELECT status,review_status,plan_revision FROM projects WHERE id=$1',[project])).rows,
    events:(await c.query('SELECT id FROM project_review_events WHERE project_id=$1 ORDER BY id',[project])).rows,
    audit:(await c.query('SELECT id FROM audit_log WHERE entity_id=$1 ORDER BY id',[project])).rows,
    receipts:(await c.query('SELECT change_id FROM sync_idempotency WHERE device_id=$1 ORDER BY change_id',[device])).rows,
  });
  await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='2s'");await c.query("SET LOCAL statement_timeout='10s'");
  await c.query(packet.migration);await c.query(packet.migration);
  await c.query("INSERT INTO users(id,username,password_hash,role,is_active) VALUES($1,$2,'probe-no-login','admin',true),($3,$4,'probe-no-login','admin',true)",[actor,'p2-review-'+actor,other,'p2-review-'+other]);
  await c.query("INSERT INTO projects(id,name,status,review_status,owner_id) VALUES($1,'Rollback-only plan review probe','planning','draft',$2)",[project,actor]);
  await check('child insert, no-op, update, move and delete version both affected plans',async()=>{
    const task=randomUUID(),second=randomUUID();
    await c.query("INSERT INTO projects(id,name,status,owner_id) VALUES($1,'Rollback-only second plan','planning',$2)",[second,actor]);
    let before=await token();
    await c.query("INSERT INTO project_tasks(id,project_id,title) VALUES($1,$2,'Probe task')",[task,project]);assert.notEqual(await token(),before);
    before=await token();await c.query('UPDATE project_tasks SET title=title,updated_at=now() WHERE id=$1',[task]);assert.equal(await token(),before);
    await c.query("UPDATE project_tasks SET title='Changed task' WHERE id=$1",[task]);assert.notEqual(await token(),before);
    before=await token();const secondBefore=await token(second);
    await c.query('UPDATE project_tasks SET project_id=$1 WHERE id=$2',[second,task]);assert.notEqual(await token(),before);assert.notEqual(await token(second),secondBefore);
    const moved=await token(second);await c.query('DELETE FROM project_tasks WHERE id=$1',[task]);assert.notEqual(await token(second),moved);
  });
  await check('nested experiment observation and measurement edits invalidate plan token',async()=>{
    const experiment=randomUUID(),observation=randomUUID(),measurement=randomUUID();
    await c.query("INSERT INTO project_experiments(id,project_id,title) VALUES($1,$2,'Probe experiment')",[experiment,project]);
    let before=await token();
    await c.query("INSERT INTO project_experiment_observations(id,experiment_id,content) VALUES($1,$2,'Observation')",[observation,experiment]);assert.notEqual(await token(),before);
    before=await token();await c.query("UPDATE project_experiment_observations SET content='Changed observation' WHERE id=$1",[observation]);assert.notEqual(await token(),before);
    before=await token();await c.query('DELETE FROM project_experiment_observations WHERE id=$1',[observation]);assert.notEqual(await token(),before);
    before=await token();await c.query("INSERT INTO project_experiment_measurements(id,experiment_id,name,value_numeric) VALUES($1,$2,'Voltage',3)",[measurement,experiment]);assert.notEqual(await token(),before);
    before=await token();await c.query('DELETE FROM project_experiments WHERE id=$1',[experiment]);assert.notEqual(await token(),before);
  });
  await check('disabled actor cannot queue server review despite stale admin claim',async()=>{
    await c.query('UPDATE users SET is_active=false WHERE id=$1',[other]);
    const before=await state();rejected(await send(await intent('submit'),{actor:other}),'REVIEW_AUTHORITY_DENIED');assert.deepEqual(await state(),before);
    await c.query('UPDATE users SET is_active=true WHERE id=$1',[other]);
  });
  const submit=await intent('submit');
  await check('actual push submit and exact receipt replay create one event and audit',async()=>{
    ok(await send(submit));const once=await state();assert.equal(once.events.length,1);assert.equal(once.audit.length,1);assert.equal(once.receipts.length,1);
    ok(await send(submit));assert.deepEqual(await state(),once);
  });
  await check('receipt rejects changed payload, device and user without changes',async()=>{
    const before=await state(),changed=structuredClone(submit);changed.payload.note='Changed note';
    rejected(await send(changed),'IDEMPOTENCY_PAYLOAD_MISMATCH');
    rejected(await send(submit,{device:randomUUID()}),'IDEMPOTENCY_OWNERSHIP_MISMATCH');
    rejected(await send(submit,{actor:other}),'IDEMPOTENCY_OWNERSHIP_MISMATCH');assert.deepEqual(await state(),before);
  });
  await check('BOM change invalidates queued approval without event, audit or receipt',async()=>{
    const approve=await intent('approve');
    await c.query("INSERT INTO project_bom_items(project_id,name) VALUES($1,'New demand after review')",[project]);
    const before=await state();rejected(await send(approve),'REVIEW_VERSION_CONFLICT');assert.deepEqual(await state(),before);
    assert.equal(approve.payload.note,'Preserve this review note');
  });
  await check('receipt failure rolls back approval; same intention retries exactly once',async()=>{
    const approve=await intent('approve'),before=await state();failReceipt=true;
    const failed=await send(approve);assert.notEqual(failed.status,'synced');assert.deepEqual(await state(),before);
    failReceipt=false;ok(await send(approve));const once=await state();assert.equal(once.project[0].status,'active');assert.equal(once.events.length,2);assert.equal(once.audit.length,2);
    ok(await send(approve));assert.deepEqual(await state(),once);
    rejected(await send(await intent('approve')),'REVIEW_STATE_CONFLICT');assert.deepEqual(await state(),once);
  });
  console.log(JSON.stringify({results,limitations:['No HTTP authentication middleware or simultaneous connections exercised','Rollback-only savepoints, not durable commit/reconnect acceptance']},null,2));
  if(results.some(r=>r.status!=='PASS'))process.exitCode=1;
}finally{await c.query('ROLLBACK');c.release();await pool.end();console.log('All probe fixtures and schema changes rolled back.');}
