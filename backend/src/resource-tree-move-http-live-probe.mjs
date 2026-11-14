import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
import {confirmationDigest} from './resource-confirmation.js';
if(process.env.LABOS_TREE_MOVE_HTTP_PROBE!=='1')throw Error('Explicit tree move probe opt-in required');
assert.match((await pool.query('SELECT current_database() AS name')).rows[0].name,/^labos_phase2_acceptance_/);
const id=Object.fromEntries(['actor','project','other','root','nested','file','target','loose_file','loose_link'].map(k=>[k,randomUUID()]));
const name=`p2_tree_${id.actor.replaceAll('-','')}`,changes=[];let fn=false,trigger=false,checks=0;
try{
 const actor=(await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','admin') RETURNING credential_version",[id.actor,name])).rows[0];
 await pool.query("INSERT INTO projects(id,name,owner_id) VALUES($1,'HTTP tree source',$3),($2,'HTTP tree target',$3)",[id.project,id.other,id.actor]);
 await pool.query("INSERT INTO resources(id,name,kind,file_type,project_id,uploaded_by) VALUES($1,'Root','folder','other',$3,$4),($2,'Target','folder','other',$5,$4)",[id.root,id.target,id.project,id.actor,id.other]);
 await pool.query("INSERT INTO resources(id,name,kind,file_type,parent_resource_id,relative_path,uploaded_by) VALUES($1,'Nested','folder','other',$2,'Nested',$3)",[id.nested,id.root,id.actor]);
 const originalFile=(await pool.query("INSERT INTO resources(id,name,kind,file_type,parent_resource_id,relative_path,storage_path,size_bytes,uploaded_by) VALUES($1,'File.pdf','file','pdf',$2,'File.pdf','unchanged-fixture-file',123,$3) RETURNING *",[id.file,id.nested,id.actor])).rows[0];
 const token=jwt.sign({userId:id.actor,credentialVersion:actor.credential_version},config.jwtSecret,{expiresIn:'10m'});
 async function request(path,body,status=200){const response=await fetch('http://127.0.0.1:4000/api/sync'+path,{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));checks++;return value;}
 const review=await request('/resources/tree/review',{resource_id:id.root,destination:{parent_resource_id:id.target}});
 assert.equal(review.account_id,id.actor);assert.equal(review.members.length,3);assert.ok(review.members.every(row=>row.storage_path===undefined));checks++;
 const event=move=>{const change={change_id:randomUUID(),entity_type:'resource',entity_id:id.root,operation:'move_tree',payload:{id:id.root,tree_move:move}};changes.push(change.change_id);return change;};
 const intent=({protocol,destination,members,source_context_sha256,destination_context_sha256})=>({protocol,destination,members,source_context_sha256,destination_context_sha256});
 async function push(change,status){const value=await request('/push',{device_id:'tree-probe',changes:[change]});assert.equal(value.results[0].status,status,JSON.stringify(value));checks++;return value.results[0];}
 await push(event({...intent(review),members:review.members.filter(row=>row.id!==id.file)}),'rejected');
 await push(event({...intent(review),destination_context_sha256:'0'.repeat(64)}),'rejected');
 const move=event(intent(review));
 await pool.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'required routed tree audit fixture'; END $$`);fn=true;
 await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.actor_user_id='${id.actor}'::uuid) EXECUTE FUNCTION ${name}()`);trigger=true;
 await push(move,'failed');assert.equal((await pool.query('SELECT project_id FROM resources WHERE id=$1',[id.root])).rows[0].project_id,id.project);assert.equal((await pool.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[move.change_id])).rowCount,0);checks++;
 await pool.query(`DROP TRIGGER ${name} ON audit_log`);trigger=false;await pool.query(`DROP FUNCTION ${name}()`);fn=false;
 await push(move,'synced');await push(move,'synced');assert.equal((await pool.query('SELECT parent_resource_id FROM resources WHERE id=$1',[id.root])).rows[0].parent_resource_id,id.target);assert.deepEqual((await pool.query('SELECT * FROM resources WHERE id=$1',[id.file])).rows[0],originalFile);assert.equal((await pool.query('SELECT 1 FROM audit_log WHERE entity_id=$1',[id.root])).rowCount,1);assert.equal((await pool.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[move.change_id])).rowCount,1);checks++;
 const confirmationBody={resource_id:id.root,device_id:'tree-probe',change_ids:[move.change_id]};
 const oldReceipt=await request('/resources/confirm',{...confirmationBody,protocol:4});assert.equal(oldReceipt.receipts[0].confirmed,false);checks++;
 const confirmed=await request('/resources/confirm',{...confirmationBody,protocol:5});const receipt=confirmed.receipts[0];assert.equal(receipt.confirmed,true);assert.equal(receipt.payload_sha256,confirmationDigest(move.payload));
 const moved=(await pool.query('SELECT * FROM resources WHERE id=$1',[id.root])).rows[0];
 const projection=Object.fromEntries(['kind','visibility','item_id','project_id','note_id','parent_resource_id','category','description','tags','name','name_source','relative_path'].map(key=>[key,moved[key]??null]));assert.equal(receipt.mutation_sha256,confirmationDigest(projection));assert.equal(receipt.storage_path,undefined);checks++;
 const foreign=await request('/resources/confirm',{...confirmationBody,device_id:'foreign-device',protocol:5});assert.deepEqual(foreign.receipts[0],{change_id:move.change_id,confirmed:false});checks++;
 await push(event(intent(review)),'rejected');
 await request('/resources/tree/review',{resource_id:id.root,destination:{parent_resource_id:id.nested}},409);
 for(const [kind,resourceId] of [['file',id.loose_file],['link',id.loose_link]]){
  await pool.query("INSERT INTO resources(id,name,kind,file_type,original_filename,storage_path,size_bytes,url,project_id,uploaded_by) VALUES($1,'Reviewed display title',$2,'other','original.dat',$3,$4,$5,$6,$7)",[resourceId,kind,kind==='file'?'unchanged-loose-file':null,kind==='file'?321:null,kind==='link'?'https://example.invalid/saved-link':null,id.project,id.actor]);
  const reviewOne=await request('/resources/tree/review',{resource_id:resourceId,destination:{parent_resource_id:id.target}});assert.equal(reviewOne.members.length,1);checks++;
  const one={change_id:randomUUID(),entity_type:'resource',entity_id:resourceId,operation:'move_tree',payload:{id:resourceId,tree_move:intent(reviewOne)}};changes.push(one.change_id);await push(one,'synced');await push(one,'synced');
  const movedOne=(await pool.query('SELECT * FROM resources WHERE id=$1',[resourceId])).rows[0];assert.equal(movedOne.parent_resource_id,id.target);assert.equal(movedOne.relative_path,kind==='file'?'original.dat':null);assert.equal(movedOne.storage_path,kind==='file'?'unchanged-loose-file':null);checks++;
  const confirmedOne=await request('/resources/confirm',{protocol:5,resource_id:resourceId,device_id:'tree-probe',change_ids:[one.change_id]});assert.equal(confirmedOne.receipts[0].confirmed,true);assert.equal(confirmedOne.receipts[0].payload_sha256,confirmationDigest(one.payload));checks++;
 }
 await pool.query("UPDATE users SET role='researcher' WHERE id=$1",[id.actor]);await pool.query("UPDATE resources SET visibility='restricted' WHERE id=$1",[id.file]);
 const denied=await request('/resources/tree/review',{resource_id:id.root,destination:{project_id:id.project}},403);assert.equal(denied.members,undefined);checks++;
 console.log(JSON.stringify({status:'PASS',checks,scope:'actual PostgreSQL/HTTP complete tree review and atomic move; incomplete/stale/cycle/private-child rejection; required audit and receipt rollback; lost-ACK replay; unchanged descendant IDs/revisions/paths'}));
}finally{
 if(trigger)await pool.query(`DROP TRIGGER IF EXISTS ${name} ON audit_log`);if(fn)await pool.query(`DROP FUNCTION IF EXISTS ${name}()`);
 await pool.query('DELETE FROM sync_idempotency WHERE change_id=ANY($1::text[])',[changes]);await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1',[id.actor]);
 await pool.query('DELETE FROM record_access_grants WHERE user_id=$1 OR created_by=$1',[id.actor]);
 await pool.query('DELETE FROM resources WHERE id=ANY($1::uuid[])',[[id.file,id.nested,id.root,id.target,id.loose_file,id.loose_link]]);
 await pool.query('DELETE FROM projects WHERE id=ANY($1::uuid[])',[[id.project,id.other]]);await pool.query('DELETE FROM users WHERE id=$1',[id.actor]);await pool.end();
}
