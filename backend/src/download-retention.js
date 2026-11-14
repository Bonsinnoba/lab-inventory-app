import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveStoragePath,STORAGE_DIR} from './storage.js';
const uuid='[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
export function attemptArtifact(name,job){
 if(!new RegExp(`^${uuid}$`,'i').test(job.id)||!new RegExp(`^${uuid}$`,'i').test(job.worker_run_id))return false;
 const prefix=`download-${job.id}-${job.worker_run_id}.`;
 return typeof name==='string'&&name.startsWith(prefix)&&!name.includes('/')&&!name.includes('\\')&&/^[a-zA-Z0-9._-]+$/.test(name);
}
const identifier=value=>'"'+String(value).replaceAll('"','""')+'"';
// All structured and path-bearing stored references, including immutable sync
// receipts and old versions, protect bytes. Unknown schema excess fails closed.
export async function storedReference(client,relative,name){
 const columns=(await client.query("SELECT table_schema,table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND (data_type IN ('json','jsonb') OR column_name IN ('storage_path','local_media_path','local_media_filename','filename','relative_path','data_json','manifest_json','payload_json','response_json','resource_json')) ORDER BY table_name,column_name LIMIT 513")).rows;
 if(columns.length>512)return true;
 for(const c of columns){const column=identifier(c.column_name);const result=await client.query(`SELECT 1 FROM ${identifier(c.table_schema)}.${identifier(c.table_name)} WHERE position($1 in ${column}::text)>0 OR position($2 in ${column}::text)>0 LIMIT 1`,[relative,name]);if(result.rowCount)return true;}
 return false;
}
// Called only after a positively acknowledged finish COMMIT and while the
// attempt's dedicated advisory lease is still held. Never scan legacy storage.
export async function reclaimFinishedAttempt(client,job,resource,{root=STORAGE_DIR,referenced=storedReference}={}){
 if(!new RegExp(`^${uuid}$`,'i').test(resource.id))return {removed:0,preserved:0};
 const directory=root===STORAGE_DIR?resolveStoragePath(resource.id):path.resolve(root,resource.id);
 const base=await fs.realpath(root),real=await fs.realpath(directory).catch(()=>null);
 if(!real||real!==path.resolve(base,resource.id)||(await fs.lstat(directory)).isSymbolicLink())return {removed:0,preserved:0};
 let removed=0,preserved=0;await client.query('BEGIN');
 try{
  const current=(await client.query('SELECT status,worker_run_id,resource_id FROM resource_download_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
  // Removed jobs and changed run IDs are uncertain, not permission to reclaim.
  if(job.lease_lost||!current||current.resource_id!==resource.id||current.worker_run_id!==job.worker_run_id||current.status==='downloading'){await client.query('ROLLBACK');return {removed,preserved};}
  await client.query('SELECT id FROM resources WHERE id=$1 FOR UPDATE',[resource.id]);
  for(const name of (await fs.readdir(directory)).filter(name=>attemptArtifact(name,job)).slice(0,32)){
   const relative=resource.id+'/'+name,filename=path.join(directory,name),before=await fs.lstat(filename);
   if(!before.isFile()||before.isSymbolicLink()||await referenced(client,relative,name)){preserved++;continue;}
   const after=await fs.lstat(filename);if(after.ino!==before.ino||after.size!==before.size||after.mtimeMs!==before.mtimeMs){preserved++;continue;}
   await fs.unlink(filename);removed++;
  }
  await client.query('COMMIT');return {removed,preserved};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}

export async function afterConfirmedFinish(finish,reclaim){if(await finish()===true)return reclaim();}
