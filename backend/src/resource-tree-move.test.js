import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {applyResourceTreeMove,treeMoveSnapshot,treeMoveIntent,treeMoveContextDigest} from './resource-tree-move.js';
const enabled=process.env.LABOS_SHARING_PG_TEST==='1';
async function fixture(work){const c=await pool.connect();try{
 assert.match((await c.query('SELECT current_database() AS name')).rows[0].name,/^labos_phase2_acceptance_/);await c.query('BEGIN');
 const id=Object.fromEntries(['actor','project','other','root','nested','file','target'].map(key=>[key,randomUUID()]));
 await c.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','admin')",[id.actor,`tree_${id.actor}`]);
 await c.query("INSERT INTO projects(id,name,owner_id) VALUES($1,'Tree source',$3),($2,'Tree target',$3)",[id.project,id.other,id.actor]);
 await c.query("INSERT INTO resources(id,name,kind,file_type,project_id,uploaded_by) VALUES($1,'Root','folder','other',$3,$4),($2,'Target','folder','other',$5,$4)",[id.root,id.target,id.project,id.actor,id.other]);
 await c.query("INSERT INTO resources(id,name,kind,file_type,parent_resource_id,relative_path,uploaded_by) VALUES($1,'Nested','folder','other',$2,'Nested',$3)",[id.nested,id.root,id.actor]);
 await c.query("INSERT INTO resources(id,name,kind,file_type,original_filename,parent_resource_id,relative_path,storage_path,size_bytes,uploaded_by) VALUES($1,'Evidence.pdf','file','pdf','Evidence.pdf',$2,'Evidence.pdf','unchanged-fixture-bytes',123,$3)",[id.file,id.nested,id.actor]);
 const rows=()=>c.query('SELECT * FROM resources WHERE id=ANY($1::uuid[]) ORDER BY id',[[id.root,id.nested,id.file]]).then(r=>r.rows);
 const change=async(destination={parent_resource_id:id.target})=>({entity_id:id.root,change_id:randomUUID(),__device_id:'tree-test',payload:{id:id.root,tree_move:{protocol:1,destination,members:treeMoveSnapshot(await rows()),source_context_sha256:await treeMoveContextDigest(c,{resourceId:id.root}),destination_context_sha256:await treeMoveContextDigest(c,{destination})}}});
 await work(c,id,{userId:id.actor,role:'admin'},change,rows);
}finally{await c.query('ROLLBACK').catch(()=>{});c.release();}}

test('tree intent rejects unknown fields, duplicate identities and ambiguous destinations',()=>{
 const id=randomUUID(),row={id,kind:'folder',name:'Root',relative_path:null,parent_resource_id:null,item_id:null,project_id:null,note_id:null,visibility:'lab',updated_at:'2026-11-08T00:00:00.000Z'};
 const change={entity_id:id,payload:{id,tree_move:{protocol:1,destination:{},members:[row],source_context_sha256:'a'.repeat(64),destination_context_sha256:'b'.repeat(64)}}};
 assert.equal(treeMoveIntent(change).members.length,1);
 for(const move of [{...change.payload.tree_move,members:[row,row]},{...change.payload.tree_move,destination:{project_id:randomUUID(),note_id:randomUUID()}},{...change.payload.tree_move,force:true}])assert.throws(()=>treeMoveIntent({...change,payload:{id,tree_move:move}}),e=>e.status===400);
});

test('PostgreSQL full nested tree move changes only root topology and preserves descendant IDs, revisions and storage',{skip:!enabled},()=>fixture(async(c,id,user,change,rows)=>{
 const before=await rows();const updated=await applyResourceTreeMove(c,await change(),user);assert.equal(updated.parent_resource_id,id.target);assert.equal(updated.project_id,null);assert.equal(updated.relative_path,'Root');
 const after=await rows();for(const child of before.filter(r=>r.id!==id.root))assert.deepEqual(after.find(r=>r.id===child.id),child);
 assert.equal((await c.query('SELECT count(*)::int AS n FROM audit_log WHERE entity_id=$1',[id.root])).rows[0].n,1);
}));

test('PostgreSQL tree move rejects missing, changed or newly added members without altering root',{skip:!enabled},()=>fixture(async(c,id,user,change)=>{
 const reviewed=await change();await assert.rejects(applyResourceTreeMove(c,{...reviewed,payload:{...reviewed.payload,tree_move:{...reviewed.payload.tree_move,members:reviewed.payload.tree_move.members.filter(r=>r.id!==id.file)}}},user),e=>e.code==='RESOURCE_TREE_CHANGED');
 await c.query("UPDATE resources SET name='Changed.pdf' WHERE id=$1",[id.file]);await assert.rejects(applyResourceTreeMove(c,reviewed,user),e=>e.code==='RESOURCE_TREE_CHANGED');
 const fresh=await change();await c.query("INSERT INTO resources(id,name,kind,file_type,parent_resource_id) VALUES($1,'New child','link','other',$2)",[randomUUID(),id.root]);await assert.rejects(applyResourceTreeMove(c,fresh,user),e=>e.code==='RESOURCE_TREE_CHANGED');
 assert.equal((await c.query('SELECT project_id FROM resources WHERE id=$1',[id.root])).rows[0].project_id,id.project);
}));

test('PostgreSQL tree move rejects cycles, collisions and project-bound descendants leaving project scope',{skip:!enabled},()=>fixture(async(c,id,user,change)=>{
 await assert.rejects(applyResourceTreeMove(c,await change({parent_resource_id:id.nested}),user),e=>e.code==='RESOURCE_TREE_CYCLE');
 await c.query("INSERT INTO resources(id,name,kind,file_type,parent_resource_id,relative_path) VALUES($1,'Root','folder','other',$2,'Root')",[randomUUID(),id.target]);
 await assert.rejects(applyResourceTreeMove(c,await change(),user),e=>e.code==='RESOURCE_FOLDER_PATH_EXISTS');
 await c.query("UPDATE resources SET visibility='project' WHERE id=$1",[id.file]);await assert.rejects(applyResourceTreeMove(c,await change({}),user),e=>e.code==='RESOURCE_VISIBILITY_CONFLICT');
}));

test('PostgreSQL reviewed source and destination contexts cannot silently change',{skip:!enabled},()=>fixture(async(c,id,user,change)=>{
 const reviewed=await change();await c.query("UPDATE resources SET name='Changed target' WHERE id=$1",[id.target]);await assert.rejects(applyResourceTreeMove(c,reviewed,user),e=>e.code==='RESOURCE_TREE_CONTEXT_CHANGED');
 const fresh=await change();await c.query("UPDATE projects SET visibility='restricted' WHERE id=$1",[id.project]);await assert.rejects(applyResourceTreeMove(c,fresh,user),e=>e.code==='RESOURCE_TREE_CONTEXT_CHANGED');
}));

test('PostgreSQL context fingerprints include timestamp-only changes',{skip:!enabled},()=>fixture(async(c,id,user,change)=>{
 const reviewed=await change();
 // The normal timestamp trigger uses transaction time; this rollback-only
 // fixture simulates a later committed revision without changing other rows.
 // The fixture owns this isolated table; do not require a superuser application
 // role merely to prepare a timestamp. Internal constraint triggers stay on.
 await c.query('ALTER TABLE resources DISABLE TRIGGER USER');
 await c.query("UPDATE resources SET updated_at=updated_at+interval '1 second' WHERE id=$1",[id.target]);
 await c.query('ALTER TABLE resources ENABLE TRIGGER USER');
 await assert.rejects(applyResourceTreeMove(c,reviewed,user),e=>e.code==='RESOURCE_TREE_CONTEXT_CHANGED');
}));

test('PostgreSQL tree move preserves unsafe legacy paths for recovery rather than adopting them',{skip:!enabled},()=>fixture(async(c,id,user,change)=>{
 await c.query("UPDATE resources SET relative_path='legacy/../Evidence.pdf' WHERE id=$1",[id.file]);await assert.rejects(applyResourceTreeMove(c,await change(),user),e=>e.code==='INVALID_UPLOAD_RELATIVE_PATH');
 assert.equal((await c.query('SELECT project_id FROM resources WHERE id=$1',[id.root])).rows[0].project_id,id.project);assert.equal((await c.query('SELECT relative_path FROM resources WHERE id=$1',[id.file])).rows[0].relative_path,'legacy/../Evidence.pdf');
}));

test('PostgreSQL tree move refuses to break project canvas references',{skip:!enabled},()=>fixture(async(c,id,user,change)=>{
 await c.query("INSERT INTO project_blocks(project_id,block_type,resource_id) VALUES($1,'pdf',$2)",[id.project,id.file]);
 await assert.rejects(applyResourceTreeMove(c,await change(),user),e=>e.code==='RESOURCE_PROJECT_MISMATCH');
 assert.equal((await c.query('SELECT project_id FROM resources WHERE id=$1',[id.root])).rows[0].project_id,id.project);
}));

test('PostgreSQL inaccessible descendant denies whole tree move, even when root is editable',{skip:!enabled},()=>fixture(async(c,id,user,change)=>{
 await c.query("UPDATE users SET role='researcher' WHERE id=$1",[id.actor]);await c.query("UPDATE resources SET visibility='restricted' WHERE id=$1",[id.file]);
 await assert.rejects(applyResourceTreeMove(c,await change(),{...user,role:'researcher'}),e=>e.status===403);
 assert.equal((await c.query('SELECT project_id FROM resources WHERE id=$1',[id.root])).rows[0].project_id,id.project);
}));

test('PostgreSQL required tree audit failure rolls back root move with unchanged descendants',{skip:!enabled},()=>fixture(async(c,id,user,change,rows)=>{
 const before=await rows(),reviewed=await change();await c.query('SAVEPOINT before_audit_failure');const name=`tree_audit_${id.actor.replaceAll('-','')}`;
 await c.query(`CREATE FUNCTION pg_temp.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'required tree audit fixture'; END $$`);
 await c.query(`CREATE TRIGGER ${name} BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.entity_id='${id.root}'::uuid) EXECUTE FUNCTION pg_temp.${name}()`);
 await assert.rejects(applyResourceTreeMove(c,reviewed,user),/required tree audit fixture/);await c.query('ROLLBACK TO SAVEPOINT before_audit_failure');assert.deepEqual(await rows(),before);
}));
after(async()=>{if(enabled)await pool.end();});
