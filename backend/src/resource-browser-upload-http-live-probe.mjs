import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
import {resolveStoragePath} from './storage.js';
import {browserResourceUpload} from './resource-browser-uploads.js';
if(process.env.LABOS_BROWSER_UPLOAD_PROBE!=='1')throw Error('Explicit browser upload probe opt-in required');
if(!(await pool.query('SELECT current_database() AS name')).rows[0].name.startsWith('labos_phase2_acceptance_'))throw Error('Isolated acceptance database required');
const actor=randomUUID(),folder=randomUUID(),fixture=`p2_upload_${actor.replaceAll('-','')}`;
const resources=new Set([folder]),files=new Map();let checks=0,trigger=false,fn=false;
const originalConnect=pool.connect;
function remember(row){if(row?.storage_path){assert.ok(row.storage_path.startsWith(row.id+'/'));resources.add(row.id);files.set(row.id,resolveStoragePath(row.storage_path));}}
try{
 const owner=(await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','viewer') RETURNING credential_version",[actor,fixture])).rows[0];
 await pool.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,'resources.create','grant')",[actor]);
 await pool.query("INSERT INTO resources(id,name,kind,file_type,uploaded_by) VALUES($1,$2,'folder','schematic_folder',$3)",[folder,fixture,actor]);
 const token=jwt.sign({userId:actor,credentialVersion:owner.credential_version},config.jwtSecret,{expiresIn:'10m'});
 const contents=Buffer.from('LabOS browser publication fixture');
 async function upload(endpoint,names,relative,key=null,bytes=contents){
  const form=new FormData();for(const name of names)form.append(relative?'files':'file',new Blob([bytes],{type:'text/plain'}),name);
  if(relative)form.append('relative_paths',JSON.stringify(relative));
  const response=await fetch(`http://127.0.0.1:4000/api/resources${endpoint}`,{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,...(key?{'Idempotency-Key':key}:{})},body:form});
  const result=await response.json();return{status:response.status,result};
 }
 const rootKey=randomUUID();const root=await upload('',[fixture+'.txt'],null,rootKey);assert.equal(root.status,201,JSON.stringify(root.result));remember(root.result);checks++;
 assert.deepEqual(await fs.readFile(files.get(root.result.id)),contents);checks++;
 const replay=await upload('',[fixture+'.txt'],null,rootKey);assert.equal(replay.status,201);assert.equal(replay.result.id,root.result.id);checks++;
 const mismatch=await upload('',[fixture+'.txt'],null,rootKey,Buffer.from('Different bytes'));assert.equal(mismatch.status,409);assert.equal(mismatch.result.error.code,'IDEMPOTENCY_PAYLOAD_MISMATCH');checks++;
 const raceKey=randomUUID(),races=await Promise.all([upload('',[fixture+'-race.txt'],null,raceKey),upload('',[fixture+'-race.txt'],null,raceKey)]);for(const reply of races){assert.equal(reply.status,201);remember(reply.result);}assert.equal(races[0].result.id,races[1].result.id);checks++;

 const nestedKey=randomUUID();const nested=await upload(`/${folder}/files`,['one.txt','two.txt'],['virtual/one.txt','virtual/two.txt'],nestedKey);assert.equal(nested.status,201,JSON.stringify(nested.result));assert.equal(nested.result.length,2);nested.result.forEach(remember);checks++;
 for(const row of nested.result){assert.equal(row.parent_resource_id,folder);assert.deepEqual(await fs.readFile(files.get(row.id)),contents);}checks++;
 const nestedReplay=await upload(`/${folder}/files`,['one.txt','two.txt'],['virtual/one.txt','virtual/two.txt'],nestedKey);assert.equal(nestedReplay.status,201);assert.deepEqual(nestedReplay.result.map(row=>row.id),nested.result.map(row=>row.id));checks++;

 const duplicate=await upload(`/${folder}/files`,['one.txt'],['virtual/one.txt']);assert.equal(duplicate.status,409);assert.equal(duplicate.result.error.code,'RESOURCE_FOLDER_PATH_EXISTS');checks++;
 assert.deepEqual(await fs.readFile(files.get(nested.result[0].id)),contents);checks++;
 // The native staging path and browser multipart path must use the same claim.
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM audit_log WHERE actor_user_id=$1',[actor])).rows[0].count,4);checks++;
 const handler=browserResourceUpload({metadata:()=>({category:'general',description:'',tags:[]})});
 async function invoke({auditFailure=false,loseCommit=false}={}){
  const filename=`${fixture}-${auditFailure?'rollback':'uncertain'}.txt`,requestKey=randomUUID();
  const input=resolveStoragePath(`_incoming/${fixture}-${randomUUID()}.part`);await fs.mkdir(path.dirname(input),{recursive:true});await fs.writeFile(input,contents);
  if(auditFailure){
   await pool.query(`CREATE FUNCTION ${fixture}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'browser upload audit fixture'; END $$`);fn=true;
   await pool.query(`CREATE TRIGGER ${fixture} BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.actor_user_id='${actor}'::uuid) EXECUTE FUNCTION ${fixture}()`);trigger=true;
  }
  pool.connect=async()=>{
   const client=await originalConnect.call(pool);
   return{release:()=>client.release(),query:async(...args)=>{
    const result=await client.query(...args);
    if(typeof args[0]==='string'&&args[0].startsWith('UPDATE resources SET storage_path'))result.rows.forEach(remember);
    if(loseCommit&&args[0]==='COMMIT')throw Error('Simulated lost COMMIT confirmation after real PostgreSQL commit');
    return result;
   }};
  };
  let status=200,result;
  try{
   const req={headers:{'idempotency-key':requestKey},user:{userId:actor,role:'viewer',credentialVersion:owner.credential_version},body:{},file:{path:input,originalname:filename,mimetype:'text/plain',size:contents.length}};
   const response={status:code=>{status=code;return response;},json:body=>{result=body;return response;}};
   await handler(req,response);
  }finally{pool.connect=originalConnect;await fs.unlink(input).catch(()=>{});}
  const rows=(await pool.query('SELECT * FROM resources WHERE uploaded_by=$1 AND original_filename=$2',[actor,filename])).rows;
  if(auditFailure){assert.equal(status,500);assert.equal(rows.length,0);assert.equal((await pool.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[requestKey])).rowCount,0);for(const [id,target]of files)if(target.endsWith('/'+filename)){await assert.rejects(fs.stat(target),error=>error.code==='ENOENT');}checks++;}
  if(loseCommit){assert.equal(status,503);assert.equal(result.error.code,'UPLOAD_CONFIRMATION_UNCERTAIN');assert.equal(rows.length,1);remember(rows[0]);assert.deepEqual(await fs.readFile(files.get(rows[0].id)),contents);checks++;}
  if(loseCommit){
   await pool.query("UPDATE resources SET description='Later reviewed details' WHERE id=$1",[rows[0].id]);
   await fs.writeFile(input,contents);const retryReq={headers:{'idempotency-key':requestKey},user:{userId:actor,role:'viewer',credentialVersion:owner.credential_version},body:{},file:{path:input,originalname:filename,mimetype:'text/plain',size:contents.length}};
   const retryRes={status:code=>{status=code;return retryRes;},json:value=>{result=value;return retryRes;}};
   await handler(retryReq,retryRes);assert.equal(status,201);assert.equal(result.id,rows[0].id);assert.equal((await pool.query('SELECT 1 FROM resources WHERE uploaded_by=$1 AND original_filename=$2',[actor,filename])).rowCount,1);checks++;
   assert.equal(result.description,'Later reviewed details');checks++;
   await pool.query('DELETE FROM resources WHERE id=$1',[rows[0].id]);await fs.writeFile(input,contents);await handler(retryReq,retryRes);assert.equal(status,409);assert.equal(result.error.code,'UPLOAD_ALREADY_RECORDED');assert.equal((await pool.query('SELECT 1 FROM resources WHERE uploaded_by=$1 AND original_filename=$2',[actor,filename])).rowCount,0);checks++;

  }

  if(trigger){await pool.query(`DROP TRIGGER ${fixture} ON audit_log`);trigger=false;}if(fn){await pool.query(`DROP FUNCTION ${fixture}()`);fn=false;}
 }
 await invoke({auditFailure:true});await invoke({loseCommit:true});
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM audit_log WHERE actor_user_id=$1',[actor])).rows[0].count,5);checks++;
 console.log(JSON.stringify({checks,status:'PASS',scope:'real browser multipart, folder path collision/no overwrite, required-audit rollback and real PostgreSQL COMMIT with lost confirmation preserving bytes'}));
}finally{
 pool.connect=originalConnect;
 if(trigger)await pool.query(`DROP TRIGGER IF EXISTS ${fixture} ON audit_log`);if(fn)await pool.query(`DROP FUNCTION IF EXISTS ${fixture}()`);
 await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1',[actor]);await pool.query('DELETE FROM sync_idempotency WHERE user_id=$1',[actor]);await pool.query('DELETE FROM resources WHERE id=ANY($1::uuid[])',[[...resources]]);
 await pool.query('DELETE FROM user_permission_overrides WHERE user_id=$1',[actor]);await pool.query('DELETE FROM users WHERE id=$1',[actor]);
 for(const [id,target]of files){
  const parent=resolveStoragePath(id);assert.equal(path.dirname(target),parent);const stat=await fs.lstat(parent).catch(()=>null);
  if(stat){assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());await fs.unlink(target).catch(error=>{if(error.code!=='ENOENT')throw error;});await fs.rmdir(parent).catch(error=>{if(!['ENOENT','ENOTEMPTY'].includes(error.code))throw error;});}
 }
 await pool.end();
}
