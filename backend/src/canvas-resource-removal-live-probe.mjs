// Actual PostgreSQL only. All fixtures and deletion effects are rolled back.
import assert from 'node:assert/strict';
import {pool} from './db.js';
if(process.env.LABOS_CANVAS_REMOVAL_PROBE!=='1')throw Error('Explicit probe opt-in required');
const client=await pool.connect();
try{
  await client.query('BEGIN');
  const project=(await client.query("INSERT INTO projects(name) VALUES('canvas removal rollback probe') RETURNING id")).rows[0].id;
  const folder=(await client.query("INSERT INTO resources(name,kind,file_type) VALUES('probe folder','folder','schematic_folder') RETURNING id")).rows[0].id;
  const resource=(await client.query("INSERT INTO resources(name,kind,file_type,parent_resource_id) VALUES('probe image','file','image',$1) RETURNING id",[folder])).rows[0].id;
  const image=(await client.query("INSERT INTO project_blocks(project_id,block_type,resource_id,x,y,title) VALUES($1,'image',$2,37,59,'Keep this title') RETURNING *",[project,resource])).rows[0];
  const note=(await client.query("INSERT INTO project_blocks(project_id,block_type,text_content) VALUES($1,'text','Keep this note') RETURNING id",[project])).rows[0].id;
  const annotated=(await client.query("INSERT INTO project_blocks(project_id,block_type,resource_id,text_content) VALUES($1,'image',$2,'Keep my annotation') RETURNING id",[project,resource])).rows[0].id;
  const connector=(await client.query("INSERT INTO project_connectors(project_id,source_block_id,target_block_id,label) VALUES($1,$2,$3,'Keep this connection') RETURNING id",[project,image.id,note])).rows[0].id;
  await client.query('SAVEPOINT direct_delete');
  await client.query('DELETE FROM resources WHERE id=$1',[resource]);
  async function verify(){
    const saved=(await client.query('SELECT * FROM project_blocks WHERE id=$1',[image.id])).rows[0];
    assert.equal(saved.block_type,'text');assert.equal(saved.resource_id,null);assert.equal(saved.text_content,'Resource removed');
    for(const key of ['id','project_id','x','y','width','height','title'])assert.equal(saved[key],image[key]);
    assert.equal((await client.query('SELECT text_content FROM project_blocks WHERE id=$1',[annotated])).rows[0].text_content,'Keep my annotation');
    assert.equal((await client.query('SELECT label FROM project_connectors WHERE id=$1',[connector])).rows[0].label,'Keep this connection');
    assert.equal((await client.query('SELECT text_content FROM project_blocks WHERE id=$1',[note])).rows[0].text_content,'Keep this note');
  }
  await verify();await client.query('ROLLBACK TO SAVEPOINT direct_delete');
  await client.query('DELETE FROM resources WHERE id=$1',[folder]);await verify();
  console.log('PASS actual PostgreSQL: direct resource and folder-cascade deletion preserve canvas IDs, layout, title, annotations and connectors. All fixtures rolled back.');
}finally{await client.query('ROLLBACK');client.release();await pool.end();}
