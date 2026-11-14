import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {attemptArtifact,reclaimFinishedAttempt,afterConfirmedFinish} from './download-retention.js';
test('retention accepts only exact canonical attempt artifacts',()=>{
 const job={id:randomUUID(),worker_run_id:randomUUID()};const name=`download-${job.id}-${job.worker_run_id}.mp4`;
 assert.equal(attemptArtifact(name,job),true);for(const value of ['../'+name,name+'/x',name+'\\x','thumbnail.jpg',name.replace(job.worker_run_id,randomUUID())])assert.equal(attemptArtifact(value,job),false);
});
test('PostgreSQL reclamation preserves shared references, active and superseded attempts, unknown files and symlinks',{skip:process.env.LABOS_REAL_PG_TEST!=='1'},async()=>{
 const {pool}=await import('./db.js');assert.match((await pool.query('SELECT current_database() AS name')).rows[0].name,/^labos_phase2_acceptance_/);
 const resource={id:randomUUID()},other=randomUUID(),job={id:randomUUID(),worker_run_id:randomUUID()};const root=await fs.mkdtemp(path.join(os.tmpdir(),'labos-download-retention-')),dir=path.join(root,resource.id);await fs.mkdir(dir);const prefix=`download-${job.id}-${job.worker_run_id}`;
 const stale=prefix+'.mp4',shared=prefix+'.keep.mp4',linked=prefix+'.linked.mp4';const client=await pool.connect();
 try{
  await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',['download-job:'+job.id]);
  await client.query("INSERT INTO resources(id,name,kind,file_type,url) VALUES($1,'Retention fixture','link','video','https://example.invalid/fixture'),($2,'Shared retention fixture','file','video',NULL)",[resource.id,other]);
  await client.query('UPDATE resources SET storage_path=$1 WHERE id=$2',[resource.id+'/'+shared,other]);
  await client.query("INSERT INTO resource_download_jobs(id,resource_id,status,worker_run_id) VALUES($1,$2,'downloading',$3)",[job.id,resource.id,job.worker_run_id]);
  for(const name of [stale,shared,'unknown-old.mp4'])await fs.writeFile(path.join(dir,name),'retained-byte-fixture');await fs.symlink(path.join(dir,shared),path.join(dir,linked));
  assert.equal((await reclaimFinishedAttempt(client,job,resource,{root})).removed,0);
  await client.query("UPDATE resource_download_jobs SET status='failed' WHERE id=$1",[job.id]);
  assert.equal((await reclaimFinishedAttempt(client,{...job,worker_run_id:randomUUID()},resource,{root})).removed,0);
  const result=await reclaimFinishedAttempt(client,job,resource,{root});assert.equal(result.removed,1);assert.equal(result.preserved,2);await assert.rejects(fs.stat(path.join(dir,stale)));for(const name of [shared,linked,'unknown-old.mp4'])await fs.lstat(path.join(dir,name));
 }finally{
  await client.query('ROLLBACK').catch(()=>{});await client.query('DELETE FROM resource_download_jobs WHERE id=$1',[job.id]);await client.query('DELETE FROM resources WHERE id=ANY($1::uuid[])',[[resource.id,other]]);await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['download-job:'+job.id]);client.release();await fs.rm(root,{recursive:true,force:true});await pool.end();
 }
});

test('artifact cleanup requires affirmative finish COMMIT, never ignored or uncertain outcomes',async()=>{
 let calls=0;for(const value of [false,undefined,null])await afterConfirmedFinish(async()=>value,async()=>calls++);assert.equal(calls,0);await assert.rejects(afterConfirmedFinish(async()=>{throw Error('uncertain COMMIT')},async()=>calls++),/uncertain/);assert.equal(calls,0);await afterConfirmedFinish(async()=>true,async()=>calls++);assert.equal(calls,1);
});
