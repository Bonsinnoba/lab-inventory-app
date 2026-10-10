import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
if(process.env.LABOS_PHASE2_COMMENTS_PROBE!=='1')throw Error('Explicit comments test opt-in required');
const users=[randomUUID(),randomUUID(),randomUUID()],project=randomUUID(),otherProject=randomUUID(),ids=[randomUUID(),randomUUID()],keys=[],marker='LABOS-P2-COMMENTS-'+randomUUID();
const key=()=>{const id=randomUUID();keys.push(id);return id;};
async function http(method,path,body,user=users[0],k){const r=await fetch('http://127.0.0.1:4000/api'+path,{method,headers:{Authorization:'Bearer '+jwt.sign({userId:user},config.jwtSecret,{expiresIn:'10m'}),'Content-Type':'application/json',...(k?{'Idempotency-Key':k}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,body:await r.json().catch(()=>null)};}
function change(id,op='create',depends=null){return{change_id:key(),entity_type:'project_comment',entity_id:id,operation:op,payload:{record:{id,project_id:project,body:'Offline discussion',author_id:users[1]},depends_on:depends}};}
async function push(changes,user=users[0]){const r=await http('POST','/sync/push',{device_id:'comment-probe',changes},user);assert.equal(r.status,200,JSON.stringify(r));return r.body.results;}
try{
  for(const[i,id]of users.entries())await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-login',$3)",[id,marker+i,i===2?'admin':'researcher']);
  for(const id of [project,otherProject])await pool.query('INSERT INTO projects(id,name,owner_id) VALUES($1,$2,$3)',[id,marker,users[0]]);
  await pool.query("INSERT INTO project_members(project_id,user_id,member_role) VALUES($1,$2,'member')",[project,users[1]]);
  const create=change(ids[0]);for(const r of await Promise.all([push([create]),push([create])]))assert.equal(r[0].status,'synced',JSON.stringify(r));
  assert.equal((await pool.query('SELECT author_id FROM project_comments WHERE id=$1',[ids[0]])).rows[0].author_id,users[0]);
  assert.equal((await pool.query('SELECT 1 FROM notifications WHERE entity_id=$1',[ids[0]])).rowCount,1,'Parallel replay must not redeliver notifications');
  assert.equal((await push([change(ids[0])]))[0].error.code,'SYNC_CONFLICT');
  assert.equal((await push([change(ids[0],'delete')],users[1]))[0].error.code,'COMMENT_AUTHOR_REQUIRED');
  const wrong=change(ids[0],'delete');wrong.payload.record.project_id=otherProject;assert.equal((await push([wrong]))[0].error.code,'COMMENT_PARENT_MISMATCH');
  const path=`/collaboration/projects/${project}/comments`,httpKey=key();const body={id:ids[1],body:'Browser discussion'};
  const first=await http('POST',path,body,users[0],httpKey);assert.equal(first.status,201,JSON.stringify(first));assert.deepEqual(await http('POST',path,body,users[0],httpKey),first);
  assert.equal((await pool.query('SELECT 1 FROM notifications WHERE entity_id=$1',[ids[1]])).rowCount,1);
  await pool.query("UPDATE projects SET visibility='restricted' WHERE id=$1",[project]);
  const pull=await http('GET','/sync/comments/pull');assert.equal(pull.body.records.some(r=>r.project_id===project),false);assert.equal(pull.body.visible_project_ids.includes(project),false);
  assert.equal((await push([create]))[0].error.code,'PROJECT_ACCESS_REQUIRED','Previously committed replay must recheck parent access');
  assert.equal((await http('POST',path,body,users[0],httpKey)).status,403);
  await pool.query("UPDATE projects SET visibility='lab' WHERE id=$1",[project]);
  const deletion=change(ids[0],'delete',create.change_id);assert.equal((await push([deletion]))[0].status,'synced');assert.equal((await push([deletion]))[0].status,'synced');
  assert.equal((await push([change(ids[0])]))[0].error.code,'SYNC_CONFLICT');
  const deleteKey=key();assert.equal((await http('DELETE',`${path}/${ids[1]}`,{},users[2],deleteKey)).status,200);assert.equal((await http('DELETE',`${path}/${ids[1]}`,{},users[2],deleteKey)).status,200);
  assert.equal((await pool.query("SELECT 1 FROM sync_tombstones WHERE entity_type='project_comment' AND entity_id=ANY($1::uuid[])",[ids])).rowCount,2);
  console.log('PASS PostgreSQL comments: authenticated author, parallel/repeated replay, exactly-once notifications, parent and author delete guards, browser replay, revoked-parent replay/read rejection, dependent delete and no resurrection.');
}finally{
  await pool.query('DELETE FROM notifications WHERE user_id=ANY($1::uuid[])',[users]);
  await pool.query('DELETE FROM project_comments WHERE project_id=ANY($1::uuid[])',[[project,otherProject]]);
  await pool.query('DELETE FROM projects WHERE id=ANY($1::uuid[])',[[project,otherProject]]);
  await pool.query('DELETE FROM sync_tombstones WHERE entity_id=ANY($1::uuid[])',[[...ids,project,otherProject]]);
  await pool.query('DELETE FROM sync_idempotency WHERE change_id=ANY($1::text[])',[keys]);
  await pool.query('DELETE FROM audit_log WHERE actor_user_id=ANY($1::uuid[])',[users]);
  await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);await pool.end();
}
