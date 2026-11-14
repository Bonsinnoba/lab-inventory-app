// Explicitly opted-in, committed HTTP fixtures in the isolated acceptance copy.
// Cleanup is restricted to UUIDs created by this invocation. No owner data reset.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
if(process.env.LABOS_REMAINING_HTTP_PROBE!=='1')throw Error('Set LABOS_REMAINING_HTTP_PROBE=1');
if(!(await pool.query('SELECT current_database() AS name')).rows[0].name.startsWith('labos_phase2_acceptance_'))throw Error('Isolated acceptance database required');
const actor=randomUUID(),device=randomUUID(),item=randomUUID(),batch=randomUUID(),expense=randomUUID(),line=randomUUID(),movement=randomUUID();
const keys=[],targets=[];let checks=0;
try{
 const user=(await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','admin') RETURNING credential_version",[actor,`remaining-http-${actor}`])).rows[0];
 const token=jwt.sign({userId:actor,credentialVersion:user.credential_version},config.jwtSecret,{expiresIn:'5m'});
 async function request(path,method='GET',body,key){const r=await fetch(`http://127.0.0.1:4000/api${path}`,{method,signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};}
 const key=()=>{const value=randomUUID();keys.push(value);return value;};
 const createKey=key(),createBody={username:`target-http-${actor}`,password:randomUUID(),role:'member'};
 let r=await request('/auth/users','POST',createBody,createKey);assert.equal(r.status,201,JSON.stringify(r));const target=r.body.user;targets.push(target.id);assert.match(target.management_etag,/^[a-f0-9]{64}$/);checks++;
 assert.deepEqual(await request('/auth/users','POST',createBody,createKey),r);checks++;
 assert.equal((await request('/auth/users','POST',{...createBody,password:randomUUID()},createKey)).body.error.code,'ADMIN_RETRY_MISMATCH');checks++;
 const updateKey=key(),update={role:'technician',expected_management_etag:target.management_etag};
 r=await request(`/auth/users/${target.id}`,'PATCH',update,updateKey);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.user.role,'technician');assert.notEqual(r.body.user.management_etag,target.management_etag);checks++;
 assert.deepEqual(await request(`/auth/users/${target.id}`,'PATCH',update,updateKey),r);checks++;
 assert.equal((await request(`/auth/users/${target.id}`,'PATCH',{role:'viewer',expected_management_etag:target.management_etag},key())).body.error.code,'ADMIN_REVIEW_STALE');checks++;
 let profile=(await request(`/auth/users/${target.id}/permissions`)).body;const permissionKey=key(),permissionBody={overrides:[{permission:'resources.create',effect:'grant'}],expected_management_etag:profile.user.management_etag};
 r=await request(`/auth/users/${target.id}/permissions`,'PUT',permissionBody,permissionKey);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.permissions.find(p=>p.permission==='resources.create').effective,true);checks++;
 assert.deepEqual(await request(`/auth/users/${target.id}/permissions`,'PUT',permissionBody,permissionKey),r);checks++;
 const resetKey=key(),reset={new_password:randomUUID(),expected_management_etag:r.body.user.management_etag};
 r=await request(`/auth/users/${target.id}/password`,'POST',reset,resetKey);assert.equal(r.status,200,JSON.stringify(r));const version=(await pool.query('SELECT credential_version FROM users WHERE id=$1',[target.id])).rows[0].credential_version;checks++;
 assert.deepEqual(await request(`/auth/users/${target.id}/password`,'POST',reset,resetKey),r);assert.equal((await pool.query('SELECT credential_version FROM users WHERE id=$1',[target.id])).rows[0].credential_version,version);checks++;
 const receipts=(await pool.query('SELECT payload_json,response_json FROM sync_idempotency WHERE change_id=ANY($1::text[])',[keys])).rows;assert.equal(receipts.length,4);assert.ok(!JSON.stringify(receipts).includes(reset.new_password));assert.ok(!JSON.stringify(receipts).includes(createBody.password));checks++;
 const push=async change=>{const result=await request('/sync/push','POST',{device_id:device,changes:[change]});assert.equal(result.status,200,JSON.stringify(result));return result.body.results[0];};
 const profileId=key(),contact={change_id:profileId,entity_type:'account_profile',entity_id:actor,operation:'update',payload:{profile:{display_name:'Offline author',email:null},expected_before:{display_name:null,email:null},previous_change_id:null}};
 assert.equal((await push(contact)).status,'synced');assert.equal((await push(contact)).status,'synced');checks++;
 assert.equal((await request('/auth/me')).body.user.display_name,'Offline author');checks++;
 const stale={...contact,change_id:key(),payload:{...contact.payload,profile:{display_name:'stale',email:null}}};assert.equal((await push(stale)).error.code,'PROFILE_REVIEW_STALE');checks++;
 const purchaseId=key(),purchase={change_id:purchaseId,entity_type:'item',entity_id:null,operation:'purchase_import',payload:{inventory_protocol:2,item_bases:[{id:item,version:0}],rows:[{operation:'create',record:{id:item,name:'HTTP purchase fixture',type:'tool',sku:null,category:null,unit:null,status:'available',initial_quantity:2,current_quantity:2,unit_cost:3,supplier:null,storage_location:null}}],batches:[{id:batch,transaction_id:expense,reference:`HTTP-${batch}`,purchase_date:'2026-11-06',supplier:null,invoice_number:null,project_id:null,currency:'USD',notes:null}],lines:[{id:line,movement_id:movement,item_id:item,purchase_batch_id:batch,quantity:2,unit_cost:3,tax:1,line_total:7,notes:null,storage_location:null}]}};
 r=await push(purchase);assert.equal(r.status,'synced',JSON.stringify(r));checks++;
 assert.equal((await push(purchase)).status,'synced');assert.equal((await pool.query('SELECT id FROM item_movements WHERE id=$1',[movement])).rowCount,1);assert.equal(Number((await pool.query('SELECT amount FROM transactions WHERE id=$1',[expense])).rows[0].amount),7);checks++;
 assert.equal((await push({...purchase,payload:{...purchase.payload,lines:[{...purchase.payload.lines[0],quantity:99}]}})).error.code,'IDEMPOTENCY_PAYLOAD_MISMATCH');checks++;
 const duplicatePurchase=await push({...purchase,change_id:key()});assert.equal(duplicatePurchase.status,'rejected');assert.equal(duplicatePurchase.error.code,'SYNC_CONFLICT');checks++;
 console.log(`Phase 2 routed PostgreSQL/API: ${checks} checks passed; own fixtures cleaned`);
}finally{
 await pool.query('DELETE FROM sync_idempotency WHERE user_id=$1 AND change_id=ANY($2::text[])',[actor,keys]);
 await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1',[actor]);
 await pool.query('DELETE FROM item_movements WHERE id=$1 AND performed_by=$2',[movement,actor]);
 await pool.query('DELETE FROM purchase_lines WHERE id=$1 AND purchase_batch_id=$2',[line,batch]);
 await pool.query('DELETE FROM purchase_batches WHERE id=$1 AND created_by=$2',[batch,actor]);
 await pool.query('DELETE FROM transactions WHERE id=$1 AND logged_by=$2',[expense,actor]);
 await pool.query('DELETE FROM items WHERE id=$1',[item]);
 await pool.query('DELETE FROM user_permission_overrides WHERE user_id=ANY($1::uuid[])',[targets]);
 await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[actor,...targets]]);await pool.end();
}
