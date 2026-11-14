import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {pool} from './db.js';import {applyAccountProfile} from './account-profile.js';
if(process.env.LABOS_ACCOUNT_PROFILE_PROBE!=='1')throw Error('Set LABOS_ACCOUNT_PROFILE_PROBE=1');const c=await pool.connect();let checks=0;
try{
 if(!(await c.query('SELECT current_database() AS n')).rows[0].n.startsWith('labos_phase2_acceptance_'))throw Error('Isolated acceptance DB required');await c.query('BEGIN');
 const actor=(await c.query("INSERT INTO users(id,username,password_hash,role,display_name) VALUES($1,$2,'not-a-login','member','Before') RETURNING *",[randomUUID(),`profile-${randomUUID()}`])).rows[0];const user={userId:actor.id,role:actor.role};
 const change={change_id:randomUUID(),entity_type:'account_profile',entity_id:actor.id,operation:'update',payload:{profile:{display_name:'First',email:null},expected_before:{display_name:'Before',email:null},previous_change_id:null},__device_id:randomUUID(),__credential_version:actor.credential_version};
 const first=await applyAccountProfile(c,change,user);assert.equal(first.profile.display_name,'First');checks++;
 const current=(await c.query('SELECT role,password_hash,credential_version FROM users WHERE id=$1',[actor.id])).rows[0];assert.equal(current.role,'member');assert.equal(current.password_hash,'not-a-login');assert.equal(current.credential_version,actor.credential_version);checks++;
 assert.equal((await c.query("SELECT 1 FROM audit_log WHERE actor_user_id=$1 AND entity_type='user_profile'",[actor.id])).rowCount,1);checks++;
 await c.query("INSERT INTO sync_idempotency(change_id,device_id,user_id,entity_type,entity_id,operation,payload_json,response_json,response_status) VALUES($1,$2,$3,'account_profile',$4,'update',$5,$6,200)",[change.change_id,change.__device_id,actor.id,actor.id,change.payload,first]);
 const next={...change,change_id:randomUUID(),payload:{profile:{display_name:'Second',email:null},expected_before:first.profile,previous_change_id:change.change_id}};
 assert.equal((await applyAccountProfile(c,next,user)).profile.display_name,'Second');checks++;
 await assert.rejects(applyAccountProfile(c,change,user),e=>e.code==='PROFILE_REVIEW_STALE');checks++;
 await assert.rejects(applyAccountProfile(c,{...next,entity_id:randomUUID()},user),e=>e.code==='PROFILE_OWNER_REQUIRED');checks++;
 await assert.rejects(applyAccountProfile(c,{...next,payload:{...next.payload,profile:{display_name:'Second',email:null,role:'admin'}}},user),e=>e.code==='INVALID_PROFILE');checks++;
 await c.query('UPDATE users SET credential_version=credential_version+1 WHERE id=$1',[actor.id]);await assert.rejects(applyAccountProfile(c,next,user),e=>e.code==='SESSION_REVOKED');checks++;
 console.log(`Account profile PostgreSQL: ${checks} checks passed; all fixtures rolled back`);
}finally{await c.query('ROLLBACK').catch(()=>{});c.release();await pool.end();}
