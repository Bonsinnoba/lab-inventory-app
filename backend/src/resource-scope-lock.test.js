import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {requireLockedResourceEditor, requireLockedResourceDestination} from './resource-scope-lock.js';
import {moveResourceAttachment} from './resource-attachment.js';
import {applyResourceMetadata} from './resource-metadata.js';
import {authorizeEditorCopy} from './resource-editor-copy.js';

const enabled = process.env.LABOS_SHARING_PG_TEST === '1';
async function fixture(work) {
  const c = await pool.connect();
  try {
    assert.match((await c.query('SELECT current_database() AS name')).rows[0].name, /^labos_phase2_acceptance_/);
    await c.query('BEGIN');
    const id = Object.fromEntries(['actor','project','note','folder','resource','destination'].map(key => [key,randomUUID()]));
    await c.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','researcher')",[id.actor,`scope_${id.actor}`]);
    await c.query("INSERT INTO projects(id,name,owner_id,visibility) VALUES($1,'Scope fixture',$2,'restricted')",[id.project,id.actor]);
    await c.query("INSERT INTO notes(id,title,body,project_id,visibility) VALUES($1,'Source note','fixture',$2,'restricted'),($3,'Target note','fixture',$2,'restricted')",[id.note,id.project,id.destination]);
    await c.query("INSERT INTO resources(id,name,kind,file_type,note_id,uploaded_by,visibility) VALUES($1,'Parent','folder','other',$2,$3,'restricted')",[id.folder,id.note,id.actor]);
    await c.query("INSERT INTO resources(id,name,kind,file_type,original_filename,parent_resource_id,uploaded_by,visibility) VALUES($1,'Fixture.pdf','file','pdf','Fixture.pdf',$2,$3,'lab')",[id.resource,id.folder,id.actor]);
    for (const [type,entity] of [['project',id.project],['note',id.note],['note',id.destination],['resource',id.folder]]) {
      await c.query('INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level,created_by) VALUES($1,$2,$3,\'edit\',$3)',[type,entity,id.actor]);
    }
    await work(c,id,{userId:id.actor,role:'researcher'});
  } finally { await c.query('ROLLBACK').catch(()=>{}); c.release(); }
}

test('PostgreSQL resource editor sees uncommitted ancestor grants and their revocation on its own client',{skip:!enabled},()=>fixture(async(c,id,user)=>{
  assert.equal((await requireLockedResourceEditor(c,id.resource,user)).ok,true);
  await c.query("UPDATE record_access_grants SET access_level='view' WHERE entity_type='note' AND entity_id=$1",[id.note]);
  await assert.rejects(requireLockedResourceEditor(c,id.resource,user),e=>e.status===403);
}));

test('PostgreSQL metadata mutation uses the locked nested scope and records its audit atomically',{skip:!enabled},()=>fixture(async(c,id,user)=>{
  const before=(await c.query('SELECT updated_at FROM resources WHERE id=$1',[id.resource])).rows[0].updated_at.toISOString();
  const change={entity_id:id.resource,__device_id:'scope-test',payload:{id:id.resource,metadata:{protocol:1,expected_updated_at:before,fields:{description:'Reviewed description'}}}};
  const result=await applyResourceMetadata(c,change,user);assert.equal(result.description,'Reviewed description');
  assert.equal((await c.query('SELECT 1 FROM audit_log WHERE entity_id=$1',[id.resource])).rowCount,1);
  await c.query("UPDATE record_access_grants SET access_level='view' WHERE entity_type='resource' AND entity_id=$1",[id.folder]);
  await assert.rejects(applyResourceMetadata(c,{...change,payload:{...change.payload,metadata:{...change.payload.metadata,expected_updated_at:result.updated_at.toISOString()}}},user),e=>e.status===403);
}));

test('PostgreSQL destination checks use same-transaction project and note authority',{skip:!enabled},()=>fixture(async(c,id,user)=>{
  assert.equal((await requireLockedResourceDestination(c,{note_id:id.destination},user)).ok,true);
  await c.query("UPDATE record_access_grants SET access_level='view' WHERE entity_type='note' AND entity_id=$1",[id.destination]);
  await assert.rejects(requireLockedResourceDestination(c,{note_id:id.destination},user),e=>e.status===403);
}));

test('PostgreSQL direct attachment rechecks locked source and destination without pooled reads',{skip:!enabled},()=>fixture(async(c,id,user)=>{
  await c.query('UPDATE resources SET parent_resource_id=NULL,note_id=$1 WHERE id=$2',[id.note,id.resource]);
  const before=(await c.query('SELECT updated_at FROM resources WHERE id=$1',[id.resource])).rows[0].updated_at.toISOString();
  const moved=await moveResourceAttachment(c,id.resource,user,{note_id:id.destination},before);
  assert.equal(moved.note_id,id.destination);assert.equal(moved.id,id.resource);
  await c.query("UPDATE record_access_grants SET access_level='view' WHERE entity_type='note' AND entity_id=$1",[id.note]);
  await assert.rejects(moveResourceAttachment(c,id.resource,user,{note_id:id.note},moved.updated_at.toISOString()),e=>e.status===403);
  assert.equal((await c.query('SELECT note_id FROM resources WHERE id=$1',[id.resource])).rows[0].note_id,id.destination);
}));

test('PostgreSQL editor copy authorizes uncommitted ancestor scope and rejects revoked access',{skip:!enabled},()=>fixture(async(c,id,user)=>{
  const source=(await c.query('SELECT * FROM resources WHERE id=$1',[id.resource])).rows[0];
  const record={...source,id:randomUUID(),derived_from_resource_id:source.id,mime_type:'application/pdf'};
  const descriptor={protocol:1,source_id:source.id,source_updated_at:source.updated_at.toISOString(),format:'pdf'};
  await authorizeEditorCopy(c,record,descriptor,user,{});
  await c.query("UPDATE record_access_grants SET access_level='view' WHERE entity_type='note' AND entity_id=$1",[id.note]);
  await assert.rejects(authorizeEditorCopy(c,record,descriptor,user,{}),e=>e.status===403);
}));

after(async()=>{if(enabled)await pool.end();});
