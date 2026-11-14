import {catalogUuid} from './catalog-sync.js';
import {getUserPermissions} from './middleware/permissions.js';
import {credentialVersionMatches} from './credential-version.js';
import {requireProjectWorkAuthority} from './project-work-authority.js';
import {writeAuditLog} from './middleware/audit.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const fields=['type','direction','amount','date','vendor','notes','item_id','project_id','funding_source_id','budget_period_id'];
const uuidFields=['item_id','project_id','funding_source_id','budget_period_id'];
const value=(row,key)=>row[key]==null?null:key==='amount'?Number(row[key]):key==='date'?new Date(row[key]).toISOString().slice(0,10):row[key];
function recordValue(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'INVALID_WORKBOOK','Transaction record required');
 const record={id:catalogUuid(input.id)};for(const key of fields)record[key]=input[key]??null;
 const types=record.direction==='income'?['donation','investment','grant','lab_allocation','other_income']:record.direction==='expense'?['purchase','repair','replacement','project_expense','other']:[];
 if(!types.includes(record.type)||typeof record.amount!=='number'||!Number.isFinite(record.amount)||record.amount<=0)fail(400,'INVALID_WORKBOOK','Invalid transaction direction, type or amount');
 if(typeof record.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(record.date)||Number.isNaN(Date.parse(record.date))||new Date(record.date).toISOString().slice(0,10)!==record.date)fail(400,'INVALID_WORKBOOK','A valid transaction date is required');
 for(const key of uuidFields)if(record[key]!==null)record[key]=catalogUuid(record[key]);
 for(const key of ['vendor','notes'])if(record[key]!==null&&(typeof record[key]!=='string'||record[key].length>20000))fail(400,'INVALID_WORKBOOK',`Invalid ${key}`);
 if(record.direction==='income'&&['donation','investment','grant'].includes(record.type)&&!record.funding_source_id)fail(400,'INVALID_WORKBOOK','Funding source is required');
 if(record.type==='project_expense'&&!record.project_id)fail(400,'INVALID_WORKBOOK','Project is required');return record;
}
// Broker owns BEGIN/COMMIT, immutable receipt and retry identity. A batch is one
// outbox intent: all rows, current authority and audit records commit together.
export async function applyFinanceWorkbook(client,change,user){
 const rows=change.payload?.rows;if(change.operation!=='import'||!Array.isArray(rows)||!rows.length||rows.length>500)fail(400,'INVALID_WORKBOOK','Provide 1–500 reviewed transaction rows');
 const actor=(await client.query('SELECT id,role,is_active,credential_version FROM users WHERE id=$1 FOR SHARE',[user.userId])).rows[0];
 if(!actor?.is_active||!credentialVersionMatches(user,actor))fail(401,'SESSION_REVOKED','Current online credentials are required');
 const permissions=await getUserPermissions(actor.id,actor.role,{client,lock:true});
 for(const p of ['finance.import','finance.view','finance.view_sensitive'])if(!permissions.has(p))fail(403,'PERMISSION_DENIED',`${p} required`);
 const prepared=rows.map(row=>{if(!['create','update'].includes(row.operation))fail(400,'INVALID_WORKBOOK','Explicit workbook operation required');return {...row,record:recordValue(row.record)};});
 const ids=prepared.map(r=>r.record.id);if(new Set(ids).size!==ids.length)fail(400,'INVALID_WORKBOOK','Duplicate transaction IDs');
 for(const id of [...ids].sort())await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['finance:'+id]);
 const existing=new Map((await client.query('SELECT * FROM transactions WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids])).rows.map(row=>[row.id,row]));
 const projects=new Set();
 for(const row of prepared){
  const old=existing.get(row.record.id),needed=row.operation==='create'?(row.record.direction==='income'?'finance.create_income':'finance.create_expense'):'finance.edit';
  if(!permissions.has(needed))fail(403,'PERMISSION_DENIED',`${needed} required`);
  if(row.operation==='create'&&old||row.operation==='update'&&!old)fail(409,'FINANCE_WORKBOOK_STALE','Transaction existence changed; review the workbook again');
  if(old){if(!row.expected_before||fields.some(key=>JSON.stringify(value(old,key))!==JSON.stringify(value(row.expected_before,key))))fail(409,'FINANCE_WORKBOOK_STALE','A transaction changed after review');
   if(old.direction!==row.record.direction&&!permissions.has(row.record.direction==='income'?'finance.create_income':'finance.create_expense'))fail(403,'PERMISSION_DENIED','Permission required for changed direction');}
  if(old?.project_id)projects.add(old.project_id);if(row.record.project_id)projects.add(row.record.project_id);
 }
 for(const project of [...projects].sort())await requireProjectWorkAuthority(client,project,user.userId);
 let created=0,updated=0;
 for(const row of prepared){
  const record=row.record,values=fields.map(key=>record[key]);
  if(row.operation==='create'){await client.query(`INSERT INTO transactions(id,${fields.join(',')},logged_by) VALUES($1,${fields.map((_,i)=>'$'+(i+2)).join(',')},$12)`,[record.id,...values,user.userId]);created++;}
  else {await client.query(`UPDATE transactions SET ${fields.map((key,i)=>key+'=$'+(i+1)).join(',')} WHERE id=$11`,[...values,record.id]);updated++;}
  await writeAuditLog({req:{user:{userId:user.userId}},action:row.operation.toUpperCase(),entityType:'transaction',entityId:record.id,oldValue:existing.get(record.id)||null,newValue:record,client,required:true,deviceId:change.__device_id,metadata:{workbook_change_id:change.change_id}});
 }
 return {imported:prepared.length,created,updated};
}
