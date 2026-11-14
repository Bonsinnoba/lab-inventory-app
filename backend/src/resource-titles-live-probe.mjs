import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {publishResourceTitle} from './resource-titles.js';
if(process.env.LABOS_RESOURCE_TITLES_PROBE!=='1')throw Error('Explicit isolated title probe opt-in required');
if(!(await pool.query('SELECT current_database() AS name')).rows[0].name.startsWith('labos_phase2_acceptance_'))throw Error('Isolated acceptance database required');
const c=await pool.connect();let checks=0;
try{
 await c.query('BEGIN');const actor=randomUUID();await c.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-a-login','admin')",[actor,`title-${actor}`]);
 for(const source of ['user',null,'url_fallback']){
  const id=randomUUID(),url=`https://example.test/title-fixture/${id}`;await c.query("INSERT INTO resources(id,name,kind,file_type,url,name_source,uploaded_by) VALUES($1,$2,'link','other',$2,$3,$4)",[id,url,source,actor]);
  const title=await publishResourceTitle(c,id,'Actual metadata title',actor);assert.equal(!!title,source==='url_fallback');const row=(await c.query('SELECT * FROM resources WHERE id=$1',[id])).rows[0];assert.equal(row.name,source==='url_fallback'?'Actual metadata title':url);assert.equal(row.name_source,source==='url_fallback'?'metadata':source);checks++;
  if(title){assert.equal(await publishResourceTitle(c,id,'A repeated provider answer',actor),null);assert.equal((await c.query('SELECT count(*)::int AS n FROM audit_log WHERE entity_id=$1',[id])).rows[0].n,1);checks++;}
 }
 const id=randomUUID();await c.query("INSERT INTO resources(id,name,kind,file_type,url,name_source,uploaded_by) VALUES($1,'https://example.test/rollback','link','other','https://example.test/rollback','url_fallback',$2)",[id,actor]);
 await c.query('SAVEPOINT audit_failure');await c.query("CREATE FUNCTION pg_temp.reject_title_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'title audit denied'; END $$");await c.query('CREATE TRIGGER reject_title_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_title_audit()');
 await assert.rejects(publishResourceTitle(c,id,'Must roll back',actor),/title audit denied/);await c.query('ROLLBACK TO SAVEPOINT audit_failure');assert.equal((await c.query('SELECT name_source FROM resources WHERE id=$1',[id])).rows[0].name_source,'url_fallback');checks++;
 console.log(`Resource titles actual PostgreSQL: ${checks} checks passed; entire probe rolled back`);
}finally{await c.query('ROLLBACK');c.release();await pool.end();}
