import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {pool} from './db.js';
import jwt from 'jsonwebtoken';
import {config} from './config.js';
import {resolveStoragePath} from './storage.js';
import {confirmationDigest} from './resource-confirmation.js';
if(process.env.LABOS_MIXED_RESOURCE_HTTP_PROBE!=='1')throw Error('Set LABOS_MIXED_RESOURCE_HTTP_PROBE=1');
if(!(await pool.query('SELECT current_database() AS name')).rows[0].name.startsWith('labos_phase2_acceptance_'))throw Error('Isolated acceptance database required');
const actor=randomUUID(),device=randomUUID(),resource=randomUUID(),item=randomUUID(),newProject=randomUUID(),newLink=randomUUID();const ids=Array.from({length:5},()=>randomUUID());let checks=0;const paths=new Set();
try{
 const user=(await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','admin') RETURNING credential_version",[actor,`mixed-${actor}`])).rows[0];
 await pool.query("INSERT INTO items(id,name,type,initial_quantity,current_quantity) VALUES($1,'mixed fixture','tool',1,1)",[item]);
 const token=jwt.sign({userId:actor,credentialVersion:user.credential_version},config.jwtSecret,{expiresIn:'5m'});
 async function request(path,body,extra={}){const r=await fetch(`http://127.0.0.1:4000/api${path}`,{method:'POST',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...extra.headers},body:extra.bytes??JSON.stringify(body)});const reply=await r.json();assert.equal(r.status,200,JSON.stringify(reply));return reply;}
 const original={id:resource,name:'Mixed.md',kind:'file',file_type:'text',original_filename:'Mixed.md',mime_type:'text/plain',size_bytes:3,visibility:'lab',category:'general',description:'',tags:[],item_id:null,project_id:null,note_id:null,parent_resource_id:null,updated_at:'2026-11-06T00:00:00.000Z',created_at:'2026-11-06T00:00:00.000Z'};
 const upload=bytes=>({protocol:1,size_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 const contents=[Buffer.from('one'),Buffer.from('version two'),Buffer.from('version three')];
 const changes=[{change_id:ids[0],entity_type:'resource',entity_id:resource,operation:'create',payload:{resource:original,upload:upload(contents[0])}},
 {change_id:ids[1],entity_type:'resource',entity_id:resource,operation:'edit_content',payload:{resource:{id:resource,kind:'file',size_bytes:contents[1].length},edit:{protocol:1,format:'markdown',expected_updated_at:original.updated_at,previous_change_id:ids[0]},upload:upload(contents[1])}},
 {change_id:ids[2],entity_type:'resource',entity_id:resource,operation:'edit_metadata',payload:{id:resource,metadata:{protocol:1,expected_updated_at:original.updated_at,fields:{description:'reviewed metadata'},previous_change_id:ids[1]}}},
 {change_id:ids[3],entity_type:'resource',entity_id:resource,operation:'attach',payload:{id:resource,attachment:{protocol:3,expected_updated_at:original.updated_at,previous_change_id:ids[2],destination:{item_id:item,project_id:null,note_id:null}}}},
 {change_id:ids[4],entity_type:'resource',entity_id:resource,operation:'edit_content',payload:{resource:{id:resource,kind:'file',size_bytes:contents[2].length},edit:{protocol:1,format:'markdown',expected_updated_at:original.updated_at,previous_change_id:ids[3]},upload:upload(contents[2])}}];
 for(const [index,bytes] of [[0,contents[0]],[1,contents[1]],[4,contents[2]]]){
  const change=changes[index],base=index===0?'/resources/uploads':'/resource-editor/uploads';
  paths.add(`_offline_uploads/${actor}/${change.change_id}/0`);paths.add(`${resource}/offline-${change.change_id}`);
  await request(`${base}/${change.change_id}/chunk`,null,{headers:{'Content-Type':'application/octet-stream','X-Resource-Id':resource,'X-File-Size':String(bytes.length),'X-File-SHA256':change.payload.upload.sha256,'X-Chunk-Offset':'0'},bytes});
 }
 const push=async batch=>(await request('/sync/push',{device_id:device,changes:batch})).results;
 const results=await push(changes);assert.equal(results.length,5);for(const r of results)assert.equal(r.status,'synced',JSON.stringify(r));checks++;
 const current=(await pool.query('SELECT * FROM resources WHERE id=$1',[resource])).rows[0];paths.add(current.storage_path);assert.equal(current.description,'reviewed metadata');assert.equal(current.item_id,item);assert.equal(Number(current.size_bytes),contents[2].length);checks++;
 assert.deepEqual(await fs.readFile(resolveStoragePath(current.storage_path)),contents[2]);checks++;
 const confirmation=await request('/sync/resources/confirm',{protocol:3,resource_id:resource,device_id:device,change_ids:ids});assert.equal(confirmation.protocol,3);assert.equal(confirmation.receipts.length,5);
 for(const [index,r] of confirmation.receipts.entries()){assert.equal(r.confirmed,true);assert.equal(r.payload_sha256,confirmationDigest(changes[index].payload));assert.match(r.mutation_sha256,/^[a-f0-9]{64}$/);checks++;}
 assert.ok(confirmation.authority.grants[0].can_edit);checks++;
 const audits=(await pool.query('SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id=$1',[actor])).rows[0].n;
 for(const r of await push(changes))assert.equal(r.status,'synced');assert.equal((await pool.query('SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id=$1',[actor])).rows[0].n,audits);checks++;
 const foreign=await request('/sync/resources/confirm',{protocol:3,resource_id:resource,device_id:randomUUID(),change_ids:ids});assert.ok(foreign.receipts.every(r=>!r.confirmed&&Object.keys(r).length===2));checks++;
 const metadata=structuredClone(changes[2]);metadata.change_id=randomUUID();ids.push(metadata.change_id);metadata.payload.metadata.previous_change_id=ids[0];const stale=await push([metadata]);assert.equal(stale[0].status,'rejected');checks++;
 const parentChange=randomUUID(),linkChange=randomUUID();ids.push(parentChange,linkChange);
 const linked={change_id:linkChange,entity_type:'resource',entity_id:newLink,operation:'create',payload:{native_create_protocol:1,resource:{id:newLink,name_source:'user',name:'Native destination fixture',kind:'link',file_type:'other',url:'https://example.test/offline-parent',project_id:newProject,visibility:'lab',category:'general',description:'',tags:[]},destination_dependencies:[{change_id:parentChange,entity_type:'project',entity_id:newProject}]}};
 const waiting=await push([linked]);assert.equal(waiting[0].status,'failed');assert.equal(waiting[0].error.code,'RESOURCE_DESTINATION_PENDING');assert.equal((await pool.query('SELECT id FROM resources WHERE id=$1',[newLink])).rowCount,0);checks++;
 const parent={change_id:parentChange,entity_type:'project',entity_id:newProject,operation:'create',payload:{id:newProject,name:'Native destination fixture',status:'planning',visibility:'lab',budget:0,description:'',priority:'normal'}};
 const parentResult=await push([parent]);assert.equal(parentResult[0].status,'synced',JSON.stringify(parentResult));assert.equal((await push([linked]))[0].status,'synced');checks++;
 const borrowed=structuredClone(linked);borrowed.change_id=randomUUID();ids.push(borrowed.change_id);borrowed.payload.destination_dependencies[0].entity_type='note';borrowed.payload.resource.note_id=newProject;delete borrowed.payload.resource.project_id;
 assert.equal((await push([borrowed]))[0].error.code,'RESOURCE_DESTINATION_DEPENDENCY_MISMATCH');checks++;
 // Standalone browser metadata uses the same routed intent, reviewed revision
 // and receipt; a retry after losing the response must not repeat its audit.
 const details={change_id:randomUUID(),entity_type:'resource',entity_id:resource,operation:'edit_metadata',payload:{id:resource,metadata:{protocol:1,expected_updated_at:new Date(current.updated_at).toISOString(),fields:{category:'research',description:'Browser-reviewed details',tags:['circuits']},previous_change_id:null}}};ids.push(details.change_id);
 const savedDetails=(await push([details]))[0];assert.equal(savedDetails.status,'synced',JSON.stringify(savedDetails));assert.equal(savedDetails.result.acknowledged,true);assert.equal(savedDetails.result.description,undefined);
 const detailResponse=await fetch(`http://127.0.0.1:4000/api/resources/${resource}`,{signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`}});assert.equal(detailResponse.status,200);const detailProjection=await detailResponse.json();assert.equal(detailProjection.description,'Browser-reviewed details');assert.deepEqual(detailProjection.tags,['circuits']);checks++;
 const detailsAudits=(await pool.query('SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id=$1',[actor])).rows[0].n;
 assert.deepEqual((await push([details]))[0],savedDetails);assert.equal((await pool.query('SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id=$1',[actor])).rows[0].n,detailsAudits);checks++;
 const staleDetails=structuredClone(details);staleDetails.change_id=randomUUID();ids.push(staleDetails.change_id);staleDetails.payload.metadata.fields.description='Stale editor';const rejectedDetails=(await push([staleDetails]))[0];assert.equal(rejectedDetails.status,'rejected');assert.equal(rejectedDetails.error.code,'RESOURCE_METADATA_CONFLICT');checks++;
 const afterDetails=(await pool.query('SELECT description FROM resources WHERE id=$1',[resource])).rows[0];assert.equal(afterDetails.description,'Browser-reviewed details');assert.equal((await pool.query('SELECT count(*)::int AS n FROM audit_log WHERE actor_user_id=$1',[actor])).rows[0].n,detailsAudits);checks++;
 const legacyDetails=await fetch(`http://127.0.0.1:4000/api/resources/${resource}`,{method:'PUT',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({description:'unreviewed overwrite'})});assert.equal(legacyDetails.status,409);assert.equal((await legacyDetails.json()).error.code,'RESOURCE_METADATA_INTENT_REQUIRED');assert.equal((await pool.query('SELECT description FROM resources WHERE id=$1',[resource])).rows[0].description,'Browser-reviewed details');checks++;
 const renameBase=(await pool.query('SELECT * FROM resources WHERE id=$1',[resource])).rows[0];
 const rename={change_id:randomUUID(),entity_type:'resource',entity_id:resource,operation:'edit_metadata',payload:{id:resource,metadata:{protocol:1,expected_updated_at:new Date(renameBase.updated_at).toISOString(),fields:{name:'Reviewed lab document'}}}};ids.push(rename.change_id);
 assert.equal((await push([rename]))[0].status,'synced');const renamed=(await pool.query('SELECT * FROM resources WHERE id=$1',[resource])).rows[0];assert.equal(renamed.name,'Reviewed lab document');assert.equal(renamed.name_source,'user');assert.equal(renamed.original_filename,renameBase.original_filename);assert.equal(renamed.storage_path,renameBase.storage_path);checks++;
 const oldNameReceipt=await request('/sync/resources/confirm',{protocol:3,resource_id:resource,device_id:device,change_ids:[rename.change_id]});assert.equal(oldNameReceipt.receipts[0].confirmed,false);checks++;
 const namedReceipt=await request('/sync/resources/confirm',{protocol:4,resource_id:resource,device_id:device,change_ids:[rename.change_id]});assert.equal(namedReceipt.receipts[0].confirmed,true);assert.equal(namedReceipt.receipts[0].payload_sha256,confirmationDigest(rename.payload));assert.equal(namedReceipt.receipts[0].mutation_sha256,confirmationDigest(Object.fromEntries(['kind','visibility','item_id','project_id','note_id','parent_resource_id','category','description','tags','name','name_source'].map(key=>[key,renamed[key]??null]))));checks++;
 const linkDetails={change_id:randomUUID(),entity_type:'resource',entity_id:newLink,operation:'edit_metadata',payload:{id:newLink,metadata:{protocol:1,expected_updated_at:original.updated_at,fields:{name:'Renamed offline link'},previous_change_id:linkChange}}};ids.push(linkDetails.change_id);assert.equal((await push([linkDetails]))[0].status,'synced');checks++;
 const linkReceipts=await request('/sync/resources/confirm',{protocol:4,resource_id:newLink,device_id:device,change_ids:[linkChange,linkDetails.change_id]});assert.equal(linkReceipts.receipts.length,2);assert.ok(linkReceipts.receipts.every(r=>r.confirmed&&r.size_bytes===undefined));checks++;
 console.log(`Mixed resource chain routed PostgreSQL/files: ${checks} checks passed; own fixtures cleaned`);
}finally{
 for(const row of (await pool.query('SELECT response_json FROM sync_idempotency WHERE user_id=$1 AND change_id=ANY($2::text[])',[actor,ids])).rows)if(row.response_json?.storage_path)paths.add(row.response_json.storage_path);
 await pool.query('DELETE FROM sync_idempotency WHERE user_id=$1 AND change_id=ANY($2::text[])',[actor,ids]);await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1',[actor]);
 await pool.query('DELETE FROM resource_upload_staging WHERE user_id=$1 AND change_id=ANY($2::uuid[])',[actor,ids]);await pool.query('DELETE FROM resources WHERE id=ANY($1::uuid[]) AND uploaded_by=$2',[[resource,newLink],actor]);
 await pool.query('DELETE FROM projects WHERE id=$1 AND owner_id=$2',[newProject,actor]);
 await pool.query('DELETE FROM items WHERE id=$1',[item]);await pool.query('DELETE FROM users WHERE id=$1',[actor]);
 for(const p of paths){const absolute=resolveStoragePath(p);await fs.unlink(absolute).catch(e=>{if(e.code!=='ENOENT')throw e;});}await pool.end();
}
