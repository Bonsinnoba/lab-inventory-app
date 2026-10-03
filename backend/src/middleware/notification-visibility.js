import { pool } from '../db.js';
import { filterReadableRows } from './read-visibility.js';

// Notification delivery is not a perpetual grant to the referenced record.
// Unknown reference types are withheld until they have an explicit policy.
export async function readableNotifications(user) {
  const result=await pool.query('SELECT id,type,title,body,entity_type,entity_id,metadata,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC',[user.userId]);
  const visible=[];
  for(const row of result.rows){
    let type=row.entity_type, id=row.entity_id;
    if(type==='project_task'||type==='project_comment'){
      const table=type==='project_task'?'project_tasks':'project_comments';
      const record=await pool.query(`SELECT project_id FROM ${table} WHERE id=$1`,[id]);
      id=record.rows[0]?.project_id;type='project';
    }
    if(type==='project'&&id&&(await filterReadableRows('projects',[{id}],user)).length)visible.push(row);
    else if(['note','resource'].includes(type)&&id&&(await filterReadableRows(`${type}s`,[{id}],user)).length)visible.push(row);
    else if(type==='item'&&id&&(await pool.query('SELECT 1 FROM items WHERE id=$1',[id])).rowCount)visible.push(row);
    else if(!type&&!id)visible.push(row);
  }
  return visible;
}
