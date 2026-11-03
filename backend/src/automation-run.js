import {getUserPermissions} from './middleware/permissions.js';
import {visibilityReadSql} from './middleware/visibility.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
export async function authorizeAutomationRun(client,userId){
 const user=(await client.query('SELECT id,role,is_active FROM users WHERE id=$1 FOR SHARE',[userId])).rows[0];
 if(!user?.is_active||!(await getUserPermissions(userId,user.role,{client,lock:true})).has('automation.run'))fail(403,'AUTOMATION_RUN_DENIED','Current automation run permission required');
 return {userId,role:user.role};
}
export async function automationDue(client,user){
 const maintenance=await client.query('SELECT id,name,next_maintenance_date FROM items WHERE next_maintenance_date<=current_date+7 ORDER BY next_maintenance_date,id');
 const calibration=await client.query('SELECT id,name,next_calibration_date FROM items WHERE next_calibration_date<=current_date+30 ORDER BY next_calibration_date,id');
 const tasks=await client.query(`SELECT t.id,t.project_id,t.title,t.assignee_id,t.due_date,p.name AS project_name FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE t.due_date<=current_date AND t.status NOT IN ('done','cancelled') AND ($2='admin' OR p.owner_id=$1 OR EXISTS(SELECT 1 FROM project_members m WHERE m.project_id=p.id AND m.user_id=$1)) AND ${visibilityReadSql({alias:'p',entityType:'project',projectIdExpression:'p.id',userIdParameter:'$1',roleParameter:'$2'})} ORDER BY t.due_date,t.id`,[user.userId,user.role]);
 return {maintenance:maintenance.rows,calibration:calibration.rows,tasks:tasks.rows};
}
export async function applyAutomationRun(client,change,user){
 if(change.operation!=='run'||change.payload?.run_id!==change.entity_id||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(change.entity_id||''))fail(400,'INVALID_AUTOMATION_RUN','A stable run UUID is required');
 const actor=await authorizeAutomationRun(client,user.userId);
 // Serialize all reminder producers: different devices/run IDs still dedupe.
 // The lock and notifications share the caller's audit/receipt transaction.
 await client.query("SELECT pg_advisory_xact_lock(hashtextextended('automation-reminders',0))");
 const due=await automationDue(client,actor);
 const recipients=(await client.query("SELECT id,role FROM users WHERE is_active=true AND role IN ('admin','researcher','technician') FOR SHARE")).rows;
 let created=0;
 const date=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
 async function notify(userId,type,title,body,entityType,entityId,key,legacyKey=key){
  const result=await client.query(`INSERT INTO notifications(user_id,type,title,body,entity_type,entity_id,metadata) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE NOT EXISTS(SELECT 1 FROM notifications WHERE user_id=$1 AND metadata->>'reminder_key' IN ($8,$9))`,[userId,type,title,body,entityType,entityId,JSON.stringify({reminder_key:key,automation_run_id:change.entity_id}),key,legacyKey]);created+=result.rowCount;
 }
 for(const item of due.maintenance)for(const recipient of recipients)await notify(recipient.id,'maintenance_due','Maintenance due',`${item.name} has maintenance due on ${date(item.next_maintenance_date)}.`,'item',item.id,`maintenance:${item.id}:${date(item.next_maintenance_date)}`,`maintenance:${item.id}:${item.next_maintenance_date}`);
 for(const item of due.calibration)for(const recipient of recipients)await notify(recipient.id,'calibration_due','Calibration due',`${item.name} has calibration due on ${date(item.next_calibration_date)}.`,'item',item.id,`calibration:${item.id}:${date(item.next_calibration_date)}`,`calibration:${item.id}:${item.next_calibration_date}`);
 for(const task of due.tasks){
  const candidates=task.assignee_id?(await client.query('SELECT id,role FROM users WHERE id=$1 AND is_active=true FOR SHARE',[task.assignee_id])).rows:recipients;
  for(const recipient of candidates){
   const readable=await client.query(`SELECT 1 FROM projects p WHERE p.id=$1 AND ${visibilityReadSql({alias:'p',entityType:'project',projectIdExpression:'p.id',userIdParameter:'$2',roleParameter:'$3'})}`,[task.project_id,recipient.id,recipient.role]);
   if(readable.rowCount)await notify(recipient.id,'task_due','Task overdue',`${task.title} in ${task.project_name} is overdue.`,'project_task',task.id,`task:${task.id}:${date(task.due_date)}`,`task:${task.id}:${task.due_date}`);
  }
 }
 return {run_id:change.entity_id,created,executed:true};
}
