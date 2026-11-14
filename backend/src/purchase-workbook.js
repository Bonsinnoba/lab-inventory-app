import {catalogUuid} from './catalog-sync.js';
import {credentialVersionMatches} from './credential-version.js';
import {getUserPermissions} from './middleware/permissions.js';
import {requireProjectWorkAuthority} from './project-work-authority.js';
import {writeAuditLog} from './middleware/audit.js';
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const money=(n)=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=999999999999.99&&Math.abs(n*100-Math.round(n*100))<1e-4;
const qty=(n)=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<=999999999.999&&Math.abs(n*1000-Math.round(n*1000))<1e-4;
const cents=n=>Math.round(n*100)/100;
const equalNumber=(a,b)=>Number.isFinite(Number(a))&&Math.abs(Number(a)-b)<1e-6;
const text=(v,max=20000)=>v===null||typeof v==='string'&&v.length<=max;
export async function applyPurchaseWorkbook(client,change,user,applyInventory){
 const p=change.payload;
 if(p?.inventory_protocol!==2||!Array.isArray(p.rows)||!p.rows.length||p.rows.length>500||!Array.isArray(p.lines)||!p.lines.length||p.lines.length>500||!Array.isArray(p.batches)||!p.batches.length||p.batches.length>500)fail(400,'INVALID_PURCHASE_WORKBOOK','Provide 1–500 reviewed purchase lines');
 const actor=(await client.query('SELECT id,role,is_active,credential_version FROM users WHERE id=$1 FOR SHARE',[user.userId])).rows[0];
 if(!actor?.is_active||!credentialVersionMatches({credentialVersion:change.__credential_version},actor))fail(401,'SESSION_REVOKED','Current credentials required');
 user={...user,role:actor.role};
 const permissions=await getUserPermissions(actor.id,actor.role,{client,lock:true});
 for(const permission of ['inventory.view','inventory.import','finance.view','finance.create_expense'])if(!permissions.has(permission))fail(403,'PERMISSION_DENIED',`${permission} required`);
 const batches=new Map(),records=new Map(),allIds=new Set();
 const identity=raw=>{const id=catalogUuid(raw);if(allIds.has(id))fail(400,'INVALID_PURCHASE_WORKBOOK','Duplicate purchase identity');allIds.add(id);return id;};
 for(const row of p.rows){if(!['create','update'].includes(row?.operation))fail(400,'INVALID_PURCHASE_WORKBOOK','Explicit inventory operation required');const id=identity(row.record?.id);records.set(id,row);}
 const references=new Set();for(const batch of p.batches){const id=identity(batch.id);identity(batch.transaction_id);
  if(typeof batch.reference!=='string'||!batch.reference.trim()||references.has(batch.reference)||batch.reference.length>256||typeof batch.purchase_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(batch.purchase_date)||Number.isNaN(Date.parse(batch.purchase_date))||new Date(batch.purchase_date).toISOString().slice(0,10)!==batch.purchase_date||typeof batch.currency!=='string'||!/^[A-Z]{3}$/.test(batch.currency))fail(400,'INVALID_PURCHASE_WORKBOOK','Invalid batch reference, date or currency');references.add(batch.reference);
  for(const field of ['supplier','invoice_number','notes'])if(!text(batch[field]))fail(400,'INVALID_PURCHASE_WORKBOOK',`Invalid batch ${field}`);
  if(batch.project_id!==null)catalogUuid(batch.project_id);batches.set(id,{...batch,id,transaction_id:catalogUuid(batch.transaction_id),project_id:batch.project_id?catalogUuid(batch.project_id):null,lines:[]});}
 const normalizedLines=p.lines.map(line=>({...line,id:identity(line.id),movement_id:identity(line.movement_id),item_id:catalogUuid(line.item_id),purchase_batch_id:catalogUuid(line.purchase_batch_id)}));
 const itemLines=new Map();for(const line of normalizedLines){const item=line.item_id,batch=batches.get(line.purchase_batch_id);
  if(!records.has(item)||!batch||!qty(line.quantity)||!money(line.unit_cost)||!money(line.tax)||!money(line.line_total)||Math.abs(line.line_total-cents(line.quantity*line.unit_cost+line.tax))>1e-6||!text(line.notes)||!text(line.storage_location))fail(400,'INVALID_PURCHASE_WORKBOOK','Invalid purchase line');
  batch.lines.push(line);if(!itemLines.has(item))itemLines.set(item,[]);itemLines.get(item).push(line);}
 if(itemLines.size!==records.size||[...batches.values()].some(b=>!b.lines.length))fail(400,'INVALID_PURCHASE_WORKBOOK','Every item and batch requires a purchase line');
 for(const project of [...new Set([...batches.values()].map(b=>b.project_id).filter(Boolean))].sort())await requireProjectWorkAuthority(client,project,user.userId);
 const ids=[...records.keys()].sort();for(const id of ids)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['inventory:'+id]);
 const before=new Map((await client.query('SELECT * FROM items WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids])).rows.map(r=>[r.id,r]));
 if(!Array.isArray(p.item_bases)||p.item_bases.length!==ids.length)fail(400,'INVALID_INVENTORY_BASE','One purchase version base per item required');
 const inventory_versions={};let createdItems=0;
 for(const id of ids){const row=records.get(id),old=before.get(id),record=row.record,lines=itemLines.get(id),received=lines.reduce((n,l)=>n+l.quantity,0);
  if(row.operation==='create'&&old||row.operation==='update'&&!old)fail(409,'SYNC_CONFLICT','Purchase target existence changed');
  if(!equalNumber(record.current_quantity,Number(old?.current_quantity||0)+received)||!equalNumber(record.initial_quantity,old?Number(old.initial_quantity):received))fail(400,'INVALID_PURCHASE_WORKBOOK','Stock projection disagrees with received quantities');
  if(old){for(const key of ['name','type','sku','category','unit','status'])if((record[key]??null)!==(old[key]??null))fail(409,'SYNC_CONFLICT','Purchase cannot overwrite unrelated inventory fields');if(!permissions.has('inventory.adjust_stock'))fail(403,'PERMISSION_DENIED','inventory.adjust_stock required');}
  let supplier=old?.supplier??null,location=old?.storage_location??null;for(const line of lines){const batch=batches.get(line.purchase_batch_id);if(batch.supplier)supplier=batch.supplier;if(line.storage_location)location=line.storage_location;}
  if(!equalNumber(record.unit_cost,lines.at(-1).unit_cost)||(record.supplier??null)!==supplier||(record.storage_location??null)!==location)fail(400,'INVALID_PURCHASE_WORKBOOK','Inventory cost/location/supplier disagrees with purchase lines');
  const bases=p.item_bases.filter(b=>catalogUuid(b?.id)===id);if(bases.length!==1)fail(400,'INVALID_INVENTORY_BASE','Duplicate or missing purchase version base');
  const result=await applyInventory(client,{...change,operation:row.operation,entity_id:id,payload:{...(row.operation==='create'?record:{id,patch:record}),id,inventory_protocol:2,item_bases:bases}},user);
  Object.assign(inventory_versions,result.inventory_versions);if(!old)createdItems++;
 }
 let expenseTotal=0,receivedQuantity=0;
 for(const batch of batches.values()){
  const tax=cents(batch.lines.reduce((n,l)=>n+l.tax,0)),total=cents(batch.lines.reduce((n,l)=>n+l.line_total,0)),subtotal=cents(total-tax);
  if(!money(total)||!money(tax)||!money(subtotal))fail(400,'INVALID_PURCHASE_WORKBOOK','Purchase batch exceeds supported monetary range');
  await client.query('INSERT INTO purchase_batches(id,reference,purchase_date,supplier,invoice_number,project_id,currency,subtotal,tax,total,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[batch.id,batch.reference,batch.purchase_date,batch.supplier,batch.invoice_number,batch.project_id,batch.currency,subtotal,tax,total,batch.notes,user.userId]);
  await client.query("INSERT INTO transactions(id,type,direction,amount,date,vendor,notes,project_id,logged_by) VALUES($1,'purchase','expense',$2,$3,$4,$5,$6,$7)",[batch.transaction_id,total,batch.purchase_date,batch.supplier,`Bulk purchase ${batch.reference}`,batch.project_id,user.userId]);
  for(const [entityType,entityId] of [['transaction',batch.transaction_id],['purchase_batch',batch.id]])await writeAuditLog({req:{user},client,required:true,action:'CREATE',entityType,entityId,newValue:{reference:batch.reference,total},deviceId:change.__device_id,metadata:{change_id:change.change_id}});
  expenseTotal=cents(expenseTotal+total);
 }
 const balances=new Map();for(const line of normalizedLines){const batch=batches.get(line.purchase_batch_id),old=before.get(line.item_id),from=balances.has(line.item_id)?balances.get(line.item_id):Number(old?.current_quantity||0),to=from+line.quantity;balances.set(line.item_id,to);receivedQuantity+=line.quantity;
  await client.query('INSERT INTO purchase_lines(id,purchase_batch_id,item_id,quantity,unit_cost,tax,line_total,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[line.id,batch.id,line.item_id,line.quantity,line.unit_cost,line.tax,line.line_total,line.notes]);
  await client.query("INSERT INTO item_movements(id,item_id,movement_type,quantity,quantity_before,quantity_after,from_storage_location,to_storage_location,project_id,reason,reference,performed_by) VALUES($1,$2,'receive',$3,$4,$5,$6,$7,$8,'Bulk purchase import',$9,$10)",[line.movement_id,line.item_id,line.quantity,from,to,old?.storage_location||null,line.storage_location,batch.project_id,batch.reference,user.userId]);
 }
 const result={ok:true,imported:p.lines.length,batches:batches.size,created_items:createdItems,received_quantity:receivedQuantity,expense_total:expenseTotal,inventory_versions};
 await writeAuditLog({req:{user},client,required:true,action:'IMPORT',entityType:'bulk_purchase',newValue:result,deviceId:change.__device_id,metadata:{change_id:change.change_id}});return result;
}
