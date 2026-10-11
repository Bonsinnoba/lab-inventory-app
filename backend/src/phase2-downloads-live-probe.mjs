// Prepared for the phase-end sweep. Requires the ACTUAL PostgreSQL service and
// migration 20261010_download_settings_version.sql; never substitutes a mock DB.
// Settings mutations stay inside a rollback transaction and cannot change the
// live worker configuration. No jobs are committed or external media fetched.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {applyDownloadSettings,downloadSettingsPayload} from './download-settings-sync.js';
import {createDownloadJob} from './download-queue-create.js';
import {applyDownloadControl} from './download-job-control.js';
if(process.env.LABOS_PHASE2_DOWNLOADS_PROBE!=='1')throw Error('Explicit downloads probe opt-in required');
const account=randomUUID(),resource=randomUUID(),marker='P2-DOWNLOADS-'+randomUUID();
let client;
async function expectFailure(fn,code){
  await client.query('SAVEPOINT expected_failure');
  try{await assert.rejects(fn,error=>error.code===code);}finally{await client.query('ROLLBACK TO SAVEPOINT expected_failure');await client.query('RELEASE SAVEPOINT expected_failure');}
}
try{
  // Authorization helpers use their own pool queries, so only the fixture
  // identity/resource are committed; exact IDs are removed in finally.
  await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-login','admin')",[account,marker]);
  await pool.query("INSERT INTO resources(id,name,kind,file_type,url) VALUES($1,$2,'link','other','https://example.invalid/phase2-download-probe')",[resource,marker]);
  client=await pool.connect();await client.query('BEGIN');
  const user={userId:account,role:'admin'},version=downloadSettingsPayload((await client.query('SELECT * FROM media_download_settings WHERE id=1 FOR UPDATE')).rows[0]).sync_version;
  assert.ok(Number.isSafeInteger(version),'Apply the download settings migration before this probe');
  const firstKey=randomUUID();
  const first={change_id:firstKey,entity_id:'global',operation:'update',__device_id:'download-probe',payload:{patch:{mode:'manual'},expected_version:version}};
  const saved=await applyDownloadSettings(client,first,user);assert.equal(saved.sync_version,version+1);
  await expectFailure(()=>applyDownloadSettings(client,{...first,change_id:randomUUID(),payload:{patch:{mode:'always'},expected_version:version}},user),'SYNC_CONFLICT');
  await client.query(`INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status)
    VALUES($1,'download-probe',$2,'media_download_settings','global','update',$3,$4,200)`,[firstKey,account,first.payload,saved]);
  const second=await applyDownloadSettings(client,{...first,change_id:randomUUID(),payload:{patch:{default_quality:'480p'},expected_version:version+1,depends_on:firstKey}},user);
  assert.equal(second.sync_version,version+2);assert.equal(second.default_quality,'480p');
  await expectFailure(()=>applyDownloadSettings(client,{...first,__device_id:'other-device',payload:{patch:{enabled:false},expected_version:version,depends_on:firstKey}},user),'SYNC_DEPENDENCY_PENDING');
  const schedule='2099-01-01T12:00:00.000Z';
  const queued=await createDownloadJob(client,{operation:'create',entity_id:randomUUID(),payload:{resource_id:resource,quality:'720p',scheduled_for:schedule}},user);
  assert.equal(queued.status,'scheduled');assert.equal(new Date(queued.scheduled_for).toISOString(),schedule);
  const repeated=await createDownloadJob(client,{operation:'create',entity_id:randomUUID(),payload:{resource_id:resource,quality:'720p'}},user);
  assert.equal(repeated.id,queued.id);assert.equal((await client.query('SELECT count(*)::int AS count FROM resource_download_jobs WHERE resource_id=$1',[resource])).rows[0].count,1);
  const control=(job,action,patch={})=>applyDownloadControl(client,{change_id:randomUUID(),entity_id:job.id,operation:action==='remove'?'delete':'update',payload:{resource_id:resource,expected_version:job.control_version,action,patch}},user);
  assert.equal(queued.control_version,0,'Apply the job control version migration');
  const edited=await control(queued,'edit',{quality:'480p',scheduled_for:null});
  assert.equal(edited.control_version,1);assert.equal(edited.status,'queued');assert.equal(edited.scheduled_for,null);
  await expectFailure(()=>control(queued,'cancel'),'SYNC_CONFLICT');
  const paused=await control(edited,'pause');assert.equal(paused.status,'paused');
  const started=await control(paused,'start');assert.equal(started.status,'queued');assert.equal(started.control_version,3);
  // Model the worker having claimed the row; actual worker races are a separate test.
  await client.query("UPDATE resource_download_jobs SET status='downloading' WHERE id=$1",[queued.id]);
  const request=await control(started,'cancel');assert.equal(request.status,'downloading');assert.equal(request.stop_requested_status,'cancelled');
  await expectFailure(()=>control(request,'remove'),'SYNC_CONFLICT');
  await client.query("UPDATE resource_download_jobs SET status='completed',stop_requested_status=NULL,cancel_requested=FALSE WHERE id=$1",[queued.id]);
  const late=await control(request,'cancel');assert.equal(late.status,'completed');assert.equal(late.control_outcome,'already_completed');
  const removed=await control(late,'remove');assert.equal(removed.deleted,true);
  assert.equal((await client.query('SELECT count(*)::int AS count FROM resources WHERE id=$1',[resource])).rows[0].count,1,'Removing history does not remove the resource');
  console.log('PASS actual PostgreSQL (rollback): settings versions/dependencies, scheduled enqueue/deduplication, job edits/start/pause/cancel/removal, stale-control rejection and late-completion semantics. HTTP replay, two-client concurrency, real worker races and desktop outage remain separate tests.');
}finally{
  if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}
  await pool.query('DELETE FROM resources WHERE id=$1',[resource]);
  await pool.query("DELETE FROM sync_tombstones WHERE entity_id=$1 AND entity_type='resource'",[resource]);
  await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1',[account]);
  await pool.query('DELETE FROM users WHERE id=$1',[account]);await pool.end();
}
