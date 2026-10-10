import { pool } from './db.js';
import { config } from './config.js';
import jwt from 'jsonwebtoken';
if(process.env.LABOS_PHASE2_COMMENTS_PROBE!=='1')throw Error('Explicit test opt-in required');
const [action,id]=process.argv.slice(2);
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id||''))throw Error('Fixture UUID required');
const name='LABOS-P2-COMMENT-CLIENT-'+id,c=await pool.connect();let result={ok:true};
try{
  await c.query('BEGIN');
  if(action==='create'){
    await c.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-login','researcher')",[id,name]);
    const project=(await c.query("INSERT INTO projects(name,owner_id,visibility) VALUES($1,$2,'lab') RETURNING id",[name,id])).rows[0].id;
    result={project,token:jwt.sign({userId:id},config.jwtSecret,{expiresIn:'15m'})};
  }else{
    if(!(await c.query('SELECT 1 FROM users WHERE id=$1 AND username=$2 FOR UPDATE',[id,name])).rowCount)throw Error('Not this fixture; refusing mutation');
    if(action!=='cleanup')throw Error('Unknown action');
    const projects=(await c.query('SELECT id FROM projects WHERE owner_id=$1 AND name=$2',[id,name])).rows.map(r=>r.id);
    await c.query('DELETE FROM project_comments WHERE project_id=ANY($1::uuid[])',[projects]);
    await c.query('DELETE FROM projects WHERE id=ANY($1::uuid[])',[projects]);
    await c.query('DELETE FROM sync_tombstones WHERE project_id=ANY($1::uuid[]) OR (entity_type=\'project\' AND entity_id=ANY($1::uuid[]))',[projects]);
    await c.query('DELETE FROM sync_idempotency WHERE user_id=$1',[id]);
    await c.query('DELETE FROM audit_log WHERE actor_user_id=$1',[id]);
    await c.query('DELETE FROM notifications WHERE user_id=$1',[id]);
    await c.query('DELETE FROM users WHERE id=$1 AND username=$2',[id,name]);
  }
  await c.query('COMMIT');console.log(JSON.stringify(result));
}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}
