import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {pool} from './db.js';import {managementSnapshot,beginAdministrativeIntent,finishAdministrativeIntent} from './administrative-intents.js';import {requireAccountManagementAuthority} from './account-management-authority.js';
if(process.env.LABOS_ADMIN_INTENTS_PROBE!=='1')throw Error('Set LABOS_ADMIN_INTENTS_PROBE=1');const c=await pool.connect();let checks=0;
try{
 if(!(await c.query('SELECT current_database() AS n')).rows[0].n.startsWith('labos_phase2_acceptance_'))throw Error('Isolated acceptance DB required');await c.query('BEGIN');
 const actor=(await c.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','admin') RETURNING *",[randomUUID(),`admin-probe-${randomUUID()}`])).rows[0];const target=(await c.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','member') RETURNING *",[randomUUID(),`target-probe-${randomUUID()}`])).rows[0];
 const user={userId:actor.id,role:actor.role,credentialVersion:actor.credential_version};
 let before=(await managementSnapshot(c,target.id))[0].user;assert.match(before.management_etag,/^[a-f0-9]{64}$/);assert.equal(Object.hasOwn(before,'password_hash'),false);assert.equal(Object.hasOwn(before,'credential_version'),false);checks++;
 await c.query('UPDATE users SET last_login_at=now() WHERE id=$1',[target.id]);assert.equal((await managementSnapshot(c,target.id))[0].user.management_etag,before.management_etag);checks++;
 const key=randomUUID(),secret=`disposable-${randomUUID()}`,req={user,body:{new_password:secret,expected_management_etag:before.management_etag},get:name=>name==='Idempotency-Key'?key:undefined};
 await requireAccountManagementAuthority(c,user,'users.reset_password',target.id);const intent=await beginAdministrativeIntent(c,req,'reset_password',target.id);assert.equal(intent.replay,false);checks++;
 await c.query("UPDATE users SET password_hash='probe-derived-password-hash' WHERE id=$1",[target.id]);await finishAdministrativeIntent(c,req,intent,'reset_password',target.id,{reauthentication_required:true});
 const stored=(await c.query('SELECT payload_json,response_json FROM sync_idempotency WHERE change_id=$1',[key])).rows[0];assert.equal(JSON.stringify(stored).includes(secret),false);assert.equal(JSON.stringify(stored).includes('probe-derived-password-hash'),false);assert.match(stored.payload_json.digest,/^[a-f0-9]{64}$/);checks++;
 const version=(await c.query('SELECT credential_version FROM users WHERE id=$1',[target.id])).rows[0].credential_version;
 const replay=await beginAdministrativeIntent(c,req,'reset_password',target.id);assert.equal(replay.replay,true);assert.equal(replay.response.reauthentication_required,true);assert.equal((await c.query('SELECT credential_version FROM users WHERE id=$1',[target.id])).rows[0].credential_version,version);checks++;
 await assert.rejects(beginAdministrativeIntent(c,{...req,body:{...req.body,new_password:'different-password'}},'reset_password',target.id),e=>e.code==='ADMIN_RETRY_MISMATCH');checks++;
 await assert.rejects(beginAdministrativeIntent(c,{...req,get:()=>randomUUID()},'reset_password',target.id),e=>e.code==='ADMIN_REVIEW_STALE');checks++;
 before=(await managementSnapshot(c,target.id))[0].user;await c.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,'finance.edit','grant')",[target.id]);assert.notEqual((await managementSnapshot(c,target.id))[0].user.management_etag,before.management_etag);checks++;
 before=(await managementSnapshot(c,target.id))[0].user;await c.query("UPDATE users SET role='viewer' WHERE id=$1",[target.id]);assert.notEqual((await managementSnapshot(c,target.id))[0].user.management_etag,before.management_etag);checks++;
 assert.equal(await beginAdministrativeIntent(c,{...req,get:()=>undefined},'reset_password',target.id),null);checks++;
 console.log(`Administrative intent PostgreSQL: ${checks} checks passed; all fixtures rolled back`);
}finally{await c.query('ROLLBACK').catch(()=>{});c.release();await pool.end();}
