import {pool} from './db.js';
import {config} from './config.js';
import jwt from 'jsonwebtoken';
if(process.env.LABOS_PHASE2_INVENTORY_PROBE!=='1')throw Error('Explicit fixture opt-in required');
const [action,id]=process.argv.slice(2);
if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id||''))throw Error('Fixture UUID required');
const name='LABOS-P2-INVENTORY-CLIENT-'+id,c=await pool.connect();let result={ok:true};
try{
  await c.query('BEGIN');
  if(action==='create'){
    await c.query("INSERT INTO users(id,username,password_hash,role) VALUES($1,$2,'not-login','admin')",[id,name]);
    const items=(await c.query("INSERT INTO items(name,type,status,initial_quantity,current_quantity) VALUES($1,'component','available',10,10),($1,'component','available',10,10) RETURNING id",[name])).rows.map(r=>r.id);
    result={items,token:jwt.sign({userId:id},config.jwtSecret,{expiresIn:'15m'})};
  }else{
    if(action!=='cleanup'||!(await c.query('SELECT 1 FROM users WHERE id=$1 AND username=$2 FOR UPDATE',[id,name])).rowCount)throw Error('Not this fixture; refusing mutation');
    // Receipts retain exact fixture IDs even after the test deletes both items.
    const ids=new Set((await c.query('SELECT id FROM items WHERE name=$1',[name])).rows.map(r=>r.id));
    for(const r of (await c.query("SELECT entity_id,payload_json FROM sync_idempotency WHERE user_id=$1 AND entity_type IN ('item','item_movement')",[id])).rows){if(r.entity_id)ids.add(r.entity_id);for(const target of r.payload_json.ids||[])ids.add(target);}
    const targets=[...ids];
    await c.query('DELETE FROM item_movements WHERE item_id=ANY($1::uuid[])',[targets]);
    await c.query("DELETE FROM items WHERE id=ANY($1::uuid[]) AND (name=$2 OR name=$2||'-first')",[targets,name]);
    await c.query("DELETE FROM sync_tombstones WHERE entity_type='item' AND entity_id=ANY($1::uuid[])",[targets]);
    await c.query('DELETE FROM sync_idempotency WHERE user_id=$1',[id]);
    await c.query('DELETE FROM audit_log WHERE actor_user_id=$1',[id]);
    await c.query('DELETE FROM notifications WHERE user_id=$1',[id]);
    await c.query('DELETE FROM users WHERE id=$1 AND username=$2',[id,name]);
  }
  await c.query('COMMIT');console.log(JSON.stringify(result));
}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}
