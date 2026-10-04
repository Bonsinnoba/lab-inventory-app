// Opt-in integration checks against the running LabOS API and its actual PG DB.
// All fixtures are UUID-namespaced and removed by exact ID in finally.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from './db.js';
import { config } from './config.js';
import { toolImplementations } from './routes/assistant.js';
import { resolveStoragePath } from './storage.js';
import fs from 'node:fs/promises';

if(process.env.LABOS_PHASE1_SURFACE_PROBE!=='1')throw new Error('Set LABOS_PHASE1_SURFACE_PROBE=1');
const ids=Object.fromEntries(['user','project','note','resource','task','requirement','transaction','pdf','notification','job'].map(k=>[k,randomUUID()]));
const marker=`LABOS-SURFACE-${randomUUID()}`;
const files=[];let derived=null;
const user={userId:ids.user,role:'researcher'};
let admin;
async function request(method,path,body,actor=user){
 const token=jwt.sign({userId:actor.userId},config.jwtSecret,{expiresIn:'10m'});
 const r=await fetch(`http://127.0.0.1:4000/api${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await r.json().catch(()=>null);return {status:r.status,body:data};
}
async function get(path,actor=user){const r=await request('GET',path,undefined,actor);assert.equal(r.status,200,`${path}: ${JSON.stringify(r)}`);return r.body;}
async function grant(type,id){await pool.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level) VALUES($1,$2,$3,'edit') ON CONFLICT(entity_type,entity_id,user_id) DO UPDATE SET access_level='edit'",[type,id,ids.user]);}
const excludes=(value,id,label)=>assert.ok(!JSON.stringify(value).includes(id),label);
try{
 const a=await pool.query("SELECT id FROM users WHERE username='balika' AND role='admin' AND is_active=true");assert.equal(a.rowCount,1);admin={userId:a.rows[0].id,role:'admin'};
 await pool.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','researcher')",[ids.user,marker]);
 await pool.query("INSERT INTO projects(id,name,owner_id,visibility) VALUES($1,$2,$3,'restricted')",[ids.project,marker,admin.userId]);
 await pool.query("INSERT INTO project_members(project_id,user_id,member_role) VALUES($1,$2,'member')",[ids.project,ids.user]);
 await pool.query("INSERT INTO notes(id,title,body,project_id,visibility) VALUES($1,$2,$2,$3,'restricted')",[ids.note,marker,ids.project]);
 await pool.query("INSERT INTO resources(id,name,kind,file_type,url,project_id,visibility) VALUES($1,$2,'link','other','https://example.com',$3,'restricted')",[ids.resource,marker,ids.project]);
 await pool.query('INSERT INTO project_tasks(id,project_id,title) VALUES($1,$2,$3)',[ids.task,ids.project,marker]);
 await pool.query("INSERT INTO notifications(id,user_id,type,title,body,entity_type,entity_id) VALUES($1,$2,'task_due',$3,$3,'project_task',$4)",[ids.notification,ids.user,marker,ids.task]);
 await pool.query("INSERT INTO resource_download_jobs(id,resource_id,requested_by,status) VALUES($1,$2,$3,'cancelled')",[ids.job,ids.resource,ids.user]);
 await pool.query('INSERT INTO project_resource_requirements(id,project_id,name) VALUES($1,$2,$3)',[ids.requirement,ids.project,marker]);
 await pool.query("INSERT INTO transactions(id,type,direction,amount,project_id,notes) VALUES($1,'project_expense','expense',9876.54,$2,$3)",[ids.transaction,ids.project,marker]);
 const hiddenSearch=await get(`/search?q=${marker}`);
 for(const id of [ids.project,ids.note,ids.resource,ids.task])excludes(hiddenSearch,id,'Search must omit hidden records');
 excludes(await get('/operations/requirements'),ids.requirement,'Requirements list must honor restricted project');
 excludes(await get('/operations/overview'),ids.requirement,'Operations overview must honor restricted project');
 assert.equal((await request('PATCH',`/operations/requirements/${ids.requirement}`,{name:'forbidden',project_id:null})).status,403);
 assert.equal((await request('GET',`/context/projects/${ids.project}`)).status,404);
 const before=await get('/reports/overview');
 excludes(await get('/experience/notifications'),ids.notification,'Notifications must recheck current project scope');
 excludes(await get('/collaboration/notifications'),ids.notification,'Both notification endpoints must agree');
 excludes(await get('/media-downloads/queue'),ids.job,'Queue must not leak restricted-resource metadata');
 // Child scope cannot broaden its parent's scope on list, detail, or sync.
 await pool.query("UPDATE notes SET visibility='lab' WHERE id=$1",[ids.note]);
 excludes(await get('/notes'),ids.note,'Lab note must honor its restricted project');
 excludes(await get('/sync/notes/pull'),ids.note,'Note pull must honor its restricted project');
 assert.equal((await request('GET',`/notes/${ids.note}`)).status,404);
 await pool.query("UPDATE notes SET visibility='restricted' WHERE id=$1",[ids.note]);
 await grant('project',ids.project);
 // Project access alone must not reveal restricted children.
 const context=await get(`/context/projects/${ids.project}`);
 excludes(context,ids.note,'Context must omit restricted note');excludes(context,ids.resource,'Context must omit restricted resource');
 const evidence=await get(`/context/projects/${ids.project}/evidence?q=${marker}`);excludes(evidence,ids.note,'Evidence must omit restricted note');
 for(const [name,args] of [['search_global',{query:marker}],['search_knowledge',{query:marker}],['get_project_workspace',{project_id:ids.project}],['list_notes',{}]]){
  const result=await toolImplementations[name](args,user);excludes(result,ids.note,`${name} note`);excludes(result,ids.resource,`${name} resource`);
 }
 await grant('note',ids.note);await grant('resource',ids.resource);
 assert.ok(JSON.stringify(await get('/experience/notifications')).includes(ids.notification));
 assert.ok(JSON.stringify(await get('/media-downloads/queue')).includes(ids.job));
 assert.ok(JSON.stringify(await get(`/context/projects/${ids.project}`)).includes(ids.note));
 assert.ok(JSON.stringify(await get(`/search?q=${marker}`)).includes(ids.resource));
 const after=await get('/reports/overview');
 const sum=rows=>rows.reduce((n,r)=>n+r.count,0);
 assert.equal(sum(after.projects),sum(before.projects)+1);assert.equal(sum(after.resources),sum(before.resources)+1);
 await pool.query('DELETE FROM record_access_grants WHERE user_id=$1',[ids.user]);
 excludes(await get(`/search?q=${marker}`),ids.note,'Revocation must affect the next response');
 await assert.rejects(()=>toolImplementations.list_recent_activity({},user));
 assert.equal((await request('GET','/collaboration/activity')).status,403);
 assert.equal((await request('GET','/system/export')).status,403);
 // Financial authority does not bypass restricted-project visibility.
 await pool.query("UPDATE users SET role='viewer' WHERE id=$1",[ids.user]);
 const financeRole=(await pool.query('SELECT role FROM users WHERE id=$1',[ids.user])).rows[0].role;
 user.role=financeRole;
 excludes(await get('/transactions'),ids.transaction,'Finance list scope');
 excludes(await get('/sync/finance/pull'),ids.transaction,'Finance pull scope');
 const totalBefore=(await get('/transactions/summary')).totals.expense;
 await grant('project',ids.project);
 assert.ok(JSON.stringify(await get('/transactions')).includes(ids.transaction));
 const totalAfter=(await get('/transactions/summary')).totals.expense;
 assert.ok(Math.abs(totalAfter-totalBefore-9876.54)<0.001,'Finance aggregate must change only after project grant');
 // Exercise the previously malformed PDF-copy INSERT and inherited visibility.
 const directory=resolveStoragePath(ids.pdf);files.push(directory);await fs.mkdir(directory,{recursive:true});
 await fs.writeFile(resolveStoragePath(`${ids.pdf}/probe.pdf`),'%PDF-1.4\n%%EOF\n');
 await pool.query("INSERT INTO resources(id,name,kind,file_type,original_filename,mime_type,storage_path,visibility) VALUES($1,$2,'file','pdf','probe.pdf','application/pdf',$3,'restricted')",[ids.pdf,marker,`${ids.pdf}/probe.pdf`]);
 const copy=await request('POST',`/resource-editor/${ids.pdf}/pdf-copy`,{},admin);
 assert.equal(copy.status,201,JSON.stringify(copy));derived=copy.body.id;files.push(resolveStoragePath(derived));
 assert.equal(copy.body.visibility,'restricted');assert.equal(copy.body.derived_from_resource_id,ids.pdf);
 assert.equal((await pool.query("SELECT 1 FROM record_access_grants WHERE entity_type='resource' AND entity_id=$1 AND user_id=$2 AND access_level='edit'",[derived,admin.userId])).rowCount,1);
 const exported=await get('/system/export',admin);assert.ok(Array.isArray(exported.tables.project_experiments));
 const location=(await pool.query('SELECT id FROM locations LIMIT 1')).rows[0];
 const item=(await pool.query('SELECT id FROM items LIMIT 1')).rows[0];
 await toolImplementations.list_locations({},admin);
 if(location)await toolImplementations.get_location({location_id:location.id},admin);
 if(item)await toolImplementations.get_item({item_id:item.id},admin);
 assert.ok(exported.tables.users.every(row=>!('password_hash' in row)),'Exports must not contain password hashes');
 await pool.query('UPDATE users SET is_active=false WHERE id=$1',[ids.user]);assert.equal((await request('GET','/search?q=anything')).status,401);
 console.log('Phase 1 surface probe PASS: search/context/evidence/assistant/reports, grant/revoke, operations stored-row authority, finance list/aggregate/pull, restricted PDF copy, export credential projection, disabled session.');
}finally{
 const entityIds=[...Object.values(ids),...(derived?[derived]:[])];
 await pool.query('DELETE FROM audit_log WHERE actor_user_id=$1 OR entity_id=ANY($2::uuid[])',[ids.user,entityIds]);
 await pool.query('DELETE FROM record_access_grants WHERE user_id=$1 OR entity_id=ANY($2::uuid[])',[ids.user,entityIds]);
 await pool.query('DELETE FROM notifications WHERE id=$1',[ids.notification]);
 await pool.query('DELETE FROM resource_download_jobs WHERE id=$1',[ids.job]);
 await pool.query('DELETE FROM resources WHERE id=ANY($1::uuid[])',[[ids.resource,ids.pdf,...(derived?[derived]:[])]]);
 await pool.query('DELETE FROM transactions WHERE id=$1',[ids.transaction]);
 await pool.query('DELETE FROM project_resource_requirements WHERE id=$1',[ids.requirement]);
 await pool.query('DELETE FROM project_tasks WHERE id=$1',[ids.task]);await pool.query('DELETE FROM notes WHERE id=$1',[ids.note]);
 await pool.query('DELETE FROM project_members WHERE project_id=$1',[ids.project]);await pool.query('DELETE FROM projects WHERE id=$1 AND name=$2',[ids.project,marker]);
 await pool.query('DELETE FROM users WHERE id=$1 AND username=$2',[ids.user,marker]);
 for(const directory of files)await fs.rm(directory,{recursive:true,force:true});
 await pool.end();
}
