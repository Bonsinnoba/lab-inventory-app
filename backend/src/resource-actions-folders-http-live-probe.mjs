import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {pool} from './db.js';
import {config} from './config.js';
import {requireFolderNamespace,requireResourceNamespace} from './resource-folder-namespace.js';
import {currentResourceActor} from './resource-sync-actor.js';
if(process.env.LABOS_RESOURCE_ACTIONS_PROBE!=='1')throw Error('Explicit resource actions probe opt-in required');
if(!(await pool.query('SELECT current_database() AS name')).rows[0].name.startsWith('labos_phase2_acceptance_'))throw Error('Isolated acceptance database required');
const actor=randomUUID(),stranger=randomUUID(),device=randomUUID(),folder=randomUUID(),child=randomUUID(),foreign=randomUUID(),empty=randomUUID(),race=randomUUID(),conflict=randomUUID();
const resources=new Set([folder,child,foreign,empty,race,conflict]);
const fixture=`p2_actions_${actor.replaceAll('-','')}`;let trigger=false,fn=false,checks=0;
const a=await pool.connect(),b=await pool.connect();
try{
 const owner=(await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','viewer') RETURNING credential_version",[actor,fixture])).rows[0];
 await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','viewer')",[stranger,fixture+'_other']);
 for(const permission of ['resources.create','resources.delete'])await pool.query("INSERT INTO user_permission_overrides(user_id,permission,effect) VALUES($1,$2,'grant')",[actor,permission]);
 await pool.query("INSERT INTO resources(id,name,kind,file_type,uploaded_by) VALUES($1,$2,'folder','schematic_folder',$3)",[folder,fixture,actor]);
 await pool.query("INSERT INTO resources(id,name,kind,file_type,url,parent_resource_id,uploaded_by) VALUES($1,'Existing link','link','other',$2,$3,$4)",[child,`https://example.test/${fixture}/child`,folder,actor]);
 await pool.query("INSERT INTO resources(id,name,kind,file_type,url,uploaded_by) VALUES($1,'Other owner','link','other',$2,$3)",[foreign,`https://example.test/${fixture}/foreign`,stranger]);
 const token=jwt.sign({userId:actor,credentialVersion:owner.credential_version},config.jwtSecret,{expiresIn:'10m'});
 async function request(method,path,body,status=200){const response=await fetch(`http://127.0.0.1:4000/api${path}`,{method,signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const reply=response.status===204?null:await response.json();assert.equal(response.status,status,JSON.stringify(reply));return reply;}
 const authority=await request('POST','/sync/resources/authority',{protocol:3,resource_ids:[folder,child,foreign]});
 const grant=id=>authority.grants.find(row=>row.resource_id===id);
 assert.equal(grant(folder).can_edit,false);assert.equal(grant(folder).can_delete,true);assert.equal(grant(folder).can_create_child,true);checks++;
 assert.equal(grant(child).can_delete,true);assert.equal(grant(child).can_create_child,false);assert.equal(grant(child).bindings.length,2);checks++;
 assert.equal(grant(foreign).can_delete,false);assert.equal(grant(foreign).scope,null);assert.equal(grant(foreign).bindings,null);checks++;
 const authorityIds=[folder,...Array.from({length:99},()=>randomUUID())];
 const largeAuthority=await request('POST','/sync/resources/authority',{protocol:4,resource_ids:authorityIds});
 assert.equal(largeAuthority.protocol,4);assert.equal(largeAuthority.grants.length,100);assert.equal(largeAuthority.grants[0].resource_id,folder);assert.equal(largeAuthority.grants[0].can_create_child,true);assert.ok(largeAuthority.grants.slice(1).every(row=>!row.can_edit&&!row.can_delete&&!row.can_create_child&&row.scope===null));assert.ok(Buffer.byteLength(JSON.stringify(largeAuthority))<2*1024*1024);checks++;
 await request('POST','/sync/resources/authority',{protocol:3,resource_ids:authorityIds.slice(0,5)},400);checks++;
 await request('POST','/sync/resources/authority',{protocol:4,resource_ids:[...authorityIds,randomUUID()]},400);checks++;
 const legacy=await request('POST','/sync/resources/authority',{protocol:2,resource_ids:[folder]});assert.equal(legacy.grants[0].can_edit,false);assert.equal(legacy.grants[0].scope,null);checks++;
 const create={change_id:randomUUID(),entity_type:'resource',entity_id:empty,operation:'create',payload:{resource:{id:empty,name:'Empty',kind:'folder',parent_resource_id:folder,relative_path:'virtual/Empty',visibility:'lab',category:'general',description:'',tags:[]}}};
 const push=events=>request('POST','/sync/push',{device_id:device,changes:events});
 for(let attempt=0;attempt<2;attempt++){const reply=await push([create]);assert.equal(reply.results[0].status,'synced',JSON.stringify(reply));checks++;}
 assert.equal((await pool.query('SELECT relative_path FROM resources WHERE id=$1',[empty])).rows[0].relative_path,'virtual/Empty');checks++;
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM audit_log WHERE entity_id=$1',[empty])).rows[0].count,1);checks++;
 const bad={...create,change_id:randomUUID(),entity_id:conflict,payload:{resource:{...create.payload.resource,id:conflict,name:'virtual',relative_path:'virtual'}}};
 const rejected=await push([bad]);assert.equal(rejected.results[0].status,'rejected');assert.equal(rejected.results[0].error.code,'RESOURCE_FOLDER_PATH_EXISTS');checks++;
 const direct=await request('POST','/resources/folder',{name:'Direct',parent_resource_id:folder,relative_path:'Direct'},201);resources.add(direct.id);assert.equal(direct.parent_resource_id,folder);checks++;
 const removeFolder={change_id:randomUUID(),entity_type:'resource',entity_id:folder,operation:'delete',payload:{id:folder}};
 const protectedTree=await push([removeFolder]);assert.equal(protectedTree.results[0].error.code,'RESOURCE_FOLDER_NOT_EMPTY');checks++;
 await request('DELETE',`/resources/${folder}`,undefined,409);assert.equal((await pool.query('SELECT count(*)::int AS count FROM resources WHERE parent_resource_id=$1',[folder])).rows[0].count,3);checks++;
 const manifest=await request('GET',`/resources/${folder}/manifest`);
 assert.equal(manifest.files.find(row=>row.id===empty).kind,'folder');assert.equal(manifest.files.find(row=>row.id===empty).relative_path,'virtual/Empty');assert.equal(manifest.files.find(row=>row.id===child).kind,'link');checks++;
 const hidden=randomUUID(),hiddenChild=randomUUID();resources.add(hidden);resources.add(hiddenChild);
 await pool.query("INSERT INTO resources(id,name,kind,file_type,parent_resource_id,visibility,uploaded_by) VALUES($1,'Private folder','folder','schematic_folder',$2,'restricted',$3)",[hidden,folder,stranger]);
 await pool.query("INSERT INTO resources(id,name,kind,file_type,parent_resource_id,url,uploaded_by) VALUES($1,'Private contents','link','other',$2,'https://example.test/private',$3)",[hiddenChild,hidden,stranger]);
 const filtered=await request('GET',`/resources/${folder}/manifest`);assert.ok(filtered.files.every(row=>row.id!==hidden&&row.id!==hiddenChild));assert.equal(filtered.files.length,manifest.files.length);checks++;
 // Real independent PostgreSQL clients: file/folder prefixes share one lock.
 await a.query('BEGIN');const pending={id:race,name:'Empty',kind:'folder',parent_resource_id:folder,relative_path:'race/Empty'};
 await requireFolderNamespace(a,pending);
 await a.query("INSERT INTO resources(id,name,kind,file_type,parent_resource_id,relative_path,uploaded_by) VALUES($1,'Empty','folder','schematic_folder',$2,'race/Empty',$3)",[race,folder,actor]);
 await b.query('BEGIN');await b.query("SET LOCAL lock_timeout='250ms'");
 await assert.rejects(requireResourceNamespace(b,{name:'race',kind:'file',parent_resource_id:folder,relative_path:'race'}),error=>error.code==='55P03');checks++;
 await b.query('ROLLBACK');await a.query('COMMIT');
 await b.query('BEGIN');await assert.rejects(requireResourceNamespace(b,{name:'race',kind:'file',parent_resource_id:folder,relative_path:'race'}),error=>error.code==='RESOURCE_FOLDER_PATH_EXISTS');checks++;await b.query('ROLLBACK');
 // A current-actor snapshot fences concurrent role/reset writes until commit.
 await a.query('BEGIN');const current=await currentResourceActor(a,{userId:actor,role:'admin',credentialVersion:owner.credential_version});assert.equal(current.role,'viewer');checks++;
 await b.query('BEGIN');await b.query("SET LOCAL lock_timeout='250ms'");await assert.rejects(b.query("UPDATE users SET role='researcher' WHERE id=$1",[actor]),error=>error.code==='55P03');checks++;await b.query('ROLLBACK');await a.query('COMMIT');
 // Required delete audit failure cannot commit deletion, tombstone or receipt.
 await pool.query(`CREATE FUNCTION ${fixture}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'resource delete audit fixture'; END $$`);fn=true;
 await pool.query(`CREATE TRIGGER ${fixture} BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.entity_id='${child}'::uuid) EXECUTE FUNCTION ${fixture}()`);trigger=true;
 const removeChild={change_id:randomUUID(),entity_type:'resource',entity_id:child,operation:'delete',payload:{id:child}};
 const failed=await push([removeChild]);assert.equal(failed.results[0].status,'failed');checks++;
 assert.equal((await pool.query('SELECT 1 FROM resources WHERE id=$1',[child])).rowCount,1);assert.equal((await pool.query("SELECT 1 FROM sync_tombstones WHERE entity_type='resource' AND entity_id=$1",[child])).rowCount,0);assert.equal((await pool.query('SELECT 1 FROM sync_idempotency WHERE change_id=$1',[removeChild.change_id])).rowCount,0);checks++;
 await pool.query(`DROP TRIGGER ${fixture} ON audit_log`);trigger=false;await pool.query(`DROP FUNCTION ${fixture}()`);fn=false;
 for(let attempt=0;attempt<2;attempt++){const reply=await push([removeChild]);assert.equal(reply.results[0].status,'synced');checks++;}
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM audit_log WHERE entity_id=$1',[child])).rows[0].count,1);checks++;
 await pool.query("UPDATE user_permission_overrides SET effect='deny' WHERE user_id=$1 AND permission='resources.delete'",[actor]);
 const revoked=await request('POST','/sync/resources/authority',{protocol:3,resource_ids:[folder]});assert.equal(revoked.grants[0].can_delete,false);assert.equal(revoked.grants[0].can_create_child,true);checks++;
 await pool.query('UPDATE users SET credential_version=credential_version+1 WHERE id=$1',[actor]);await request('POST','/sync/resources/authority',{protocol:3,resource_ids:[folder]},401);checks++;
 console.log(JSON.stringify({checks,status:'PASS',scope:'granular action grants, empty/nested folders, native/browser delete parity, required-audit rollback, retry/replay, namespace races and current-actor locking'}));
}finally{
 await a.query('ROLLBACK').catch(()=>{});await b.query('ROLLBACK').catch(()=>{});a.release();b.release();
 if(trigger)await pool.query(`DROP TRIGGER IF EXISTS ${fixture} ON audit_log`);if(fn)await pool.query(`DROP FUNCTION IF EXISTS ${fixture}()`);
 await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1',[actor]);await pool.query('DELETE FROM sync_idempotency WHERE user_id=$1',[actor]);
 await pool.query("DELETE FROM sync_tombstones WHERE entity_type='resource' AND entity_id=ANY($1::uuid[])",[[...resources]]);
 await pool.query("DELETE FROM record_access_grants WHERE entity_type='resource' AND entity_id=ANY($1::uuid[])",[[...resources]]);
 await pool.query('DELETE FROM resources WHERE id=ANY($1::uuid[])',[[...resources]]);await pool.query('DELETE FROM user_permission_overrides WHERE user_id=$1',[actor]);await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[actor,stranger]]);await pool.end();
}
