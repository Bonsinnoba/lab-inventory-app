// Development-only SQL policy verification; fixture writes always roll back.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from './db.js';
import {visibilityReadSql} from './middleware/visibility.js';

if(process.env.LABOS_DEV_VISIBILITY_PROBE!=='rollback-only')throw Error('Explicit rollback-only development opt-in required');
const client=await pool.connect();
const ids=[randomUUID(),randomUUID(),randomUUID()];
try{
 await client.query('BEGIN');
 await client.query("SET LOCAL statement_timeout='15s'");
 await client.query("SET LOCAL lock_timeout='1s'");
 const users=(await client.query('SELECT id FROM users ORDER BY id LIMIT 2')).rows;
 assert.equal(users.length,2,'Two existing development users required');
 const owner=users[0].id,member=users[1].id,outsider=randomUUID();
 for(const [index,visibility] of ['lab','project','restricted'].entries()){
  await client.query('INSERT INTO projects(id,name,owner_id,visibility) VALUES($1,$2,$3,$4)',[ids[index],'Rollback visibility probe',owner,visibility]);
 }
 await client.query("INSERT INTO project_members(project_id,user_id,member_role) VALUES($1,$2,'member')",[ids[1],member]);
 const predicate=visibilityReadSql({alias:'p',entityType:'project',userIdParameter:'$1',roleParameter:'$2',projectIdExpression:'p.id'});
 async function expect(user,role,indices,label){
  const actual=(await client.query(`SELECT p.id FROM projects p WHERE p.id=ANY($3::uuid[]) AND ${predicate} ORDER BY p.id`,[user,role,ids])).rows.map(row=>row.id);
  assert.deepEqual(actual,indices.map(index=>ids[index]).sort(),label);
 }
 await expect(owner,'researcher',[0,1],'Owner must not implicitly bypass restricted grants');
 await expect(member,'researcher',[0,1],'Project membership');
 await expect(outsider,'researcher',[0],'Unrelated principal');
 await expect(owner,'admin',[0,1,2],'Admin visibility');
 await client.query("INSERT INTO record_access_grants(entity_type,entity_id,user_id,access_level) VALUES('project',$1,$2,'view')",[ids[2],member]);
 await expect(member,'researcher',[0,1,2],'Explicit restricted grant');
 await expect(owner,'researcher',[0,1],'Grant must not leak to owner');
 await client.query("DELETE FROM record_access_grants WHERE entity_type='project' AND entity_id=$1 AND user_id=$2",[ids[2],member]);
 await expect(member,'researcher',[0,1],'Grant revocation');
 await client.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',[ids[1],member]);
 await expect(member,'researcher',[0],'Membership revocation');
 console.log('PASS: 8 production SQL visibility cases: lab/project/restricted, owner/member/unrelated/admin, grants and revocation.');
 console.log('Not verified: JWT authentication, domain-permission middleware, HTTP endpoint assembly, native permission cache or reconnect.');
}finally{
 try{
  await client.query('ROLLBACK');
  for(const [table,column] of [['projects','id'],['project_members','project_id'],['record_access_grants','entity_id']]){
   assert.equal((await client.query(`SELECT 1 FROM ${table} WHERE ${column}=ANY($1::uuid[])`,[ids])).rowCount,0,'Visibility fixture survived rollback');
  }
  console.log('PASS: visibility projects, memberships and grants absent after rollback.');
 }finally{client.release();await pool.end();}
}
